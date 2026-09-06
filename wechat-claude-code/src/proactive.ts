import type { Config } from './config.js';
import type { Session } from './session.js';
import type { AccountData } from './wechat/accounts.js';
import { claudeQuery } from './claude/provider.js';
import { logger } from './logger.js';
import { homedir } from 'node:os';

export const DEFAULT_IDLE_MIN_HOURS = 2;
export const DEFAULT_IDLE_MAX_HOURS = 4;
export const DEFAULT_QUIET_START = 23;
export const DEFAULT_QUIET_END = 7;

/** 与 send.ts 的 sender 对齐的最小接口，避免运行时耦合。 */
export interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
  startTyping(toUserId: string, contextToken: string): () => void;
}

export interface SessionStoreLike {
  addChatMessage(session: Session, role: 'user' | 'assistant', content: string): void;
  save(accountId: string, session: Session): void;
}

export interface IdleProactiveDeps {
  account: AccountData;
  session: Session;
  sessionStore: SessionStoreLike;
  sender: SenderLike;
  loadConfig(): Config;
  getLastContextToken(): string;
  /** 聊天模式完整系统提示（人设 + 桥接 + 无换行硬规则），与 sendToClaude 一致。 */
  buildChatSystemPrompt(): string;
  /** 聊天模式分段器（splitChatLines）。 */
  split(text: string): string[];
}

/** 随机等待时长（小时 → 毫秒），落在 [min, max] 之间；min/max 缺省 2/4 小时。 */
export function randomProactiveDelayMs(config: Config): number {
  const minH = Math.max(0.25, config.idleProactiveMinHours ?? DEFAULT_IDLE_MIN_HOURS);
  const maxH = Math.max(minH, config.idleProactiveMaxHours ?? DEFAULT_IDLE_MAX_HOURS);
  const hours = minH + Math.random() * (maxH - minH);
  return Math.round(hours * 3_600_000);
}

/** 该时刻是否落在静默窗口内（默认 23:00–07:00，start==end 表示不静默）。 */
export function withinQuietWindow(d: Date, config: Config): boolean {
  const start = config.idleProactiveQuietStart ?? DEFAULT_QUIET_START;
  const end = config.idleProactiveQuietEnd ?? DEFAULT_QUIET_END;
  if (start === end) return false;
  const hour = d.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** now 之后最近的静默窗口结束时刻（含次日回卷），返回需等待的毫秒数。 */
export function untilAfterQuietWindow(config: Config, now: Date = new Date()): number {
  const end = (config.idleProactiveQuietEnd ?? DEFAULT_QUIET_END) % 24;
  const cand = new Date(now);
  cand.setHours(end, 0, 0, 0);
  if (cand.getTime() <= now.getTime()) {
    cand.setDate(cand.getDate() + 1);
  }
  return cand.getTime() - now.getTime();
}

/**
 * 空闲主动消息。聊天空闲达到随机时长后，以人设身份主动给绑定用户发一条短消息，
 * 并作为 assistant 消息写入 chatHistory（计入 /update 蒸馏原料）。任何真实用户消息都会重置计时。
 */
export function startIdleProactive(deps: IdleProactiveDeps): { reset(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    if (stopped) return;
    clearTimer();
    const config = deps.loadConfig();
    if (config.idleProactiveEnabled === false) return; // 显式关闭则不设计时
    let delay = randomProactiveDelayMs(config);
    // 避免后半夜发：若随机目标落在静默窗口，顺延到窗口结束。
    if (withinQuietWindow(new Date(Date.now() + delay), config)) {
      delay = untilAfterQuietWindow(config);
    }
    timer = setTimeout(() => {
      timer = null;
      void fireFlow();
    }, delay);
  }

  async function fireFlow(): Promise<void> {
    const config = deps.loadConfig();
    if (config.idleProactiveEnabled === false) { schedule(); return; }
    if (deps.session.state !== 'idle' || deps.session.mode !== 'chat') { schedule(); return; }
    await fireProactive(deps);
    schedule();
  }

  return {
    reset: () => schedule(),
    stop: () => { stopped = true; clearTimer(); },
  };
}

/** 真正执行一次主动消息：生成、推送、计入历史。失败只记日志，不打扰用户。 */
async function fireProactive(deps: IdleProactiveDeps): Promise<void> {
  const { account, session, sessionStore, sender, loadConfig, getLastContextToken, buildChatSystemPrompt, split } = deps;
  const config = loadConfig();
  if (!config.systemPrompt) return;                   // 没人设不主动
  if (session.state !== 'idle' || session.mode !== 'chat') return;
  if (!account.userId) return;                        // 不知道发给谁

  session.state = 'processing';
  sessionStore.save(account.accountId, session);

  const fromUserId = account.userId;
  const contextToken = getLastContextToken();
  const cwd = (session.workingDirectory || config.workingDirectory).replace(/^~/, homedir());
  const abortController = new AbortController();
  const stopTyping = sender.startTyping(fromUserId, contextToken);

  const prompt = [
    '【这是一个"你先开口"的时刻——请向对方发送下面这条消息本身，不要复述本段、也不要提到本段里的设定】',
    '你已经有一段时间没有收到 ta 的消息了，这次由你主动开口。',
    '现在请以"你自己"（也就是你人设里定义的那个 ta）的身份，给 ta 发一条微信短消息：',
    '- 只发一条，一到两句即可，不要长篇大论；',
    '- 内容完全符合你的性格、说话习惯、称呼方式和你们当下的相处氛围；',
    '- 可以是想找 ta 说话、随口问 ta 在干嘛、分享你此刻正在想的事，或一句自然的关心；',
    '- 去掉所有符合模板的客套，像平时聊天那样自然，不要出现"系统""指令""空闲"这类词。',
    '直接输出你要发送的那条消息本身，不要任何解释或前后缀。',
  ].join('\n');

  try {
    const result = await claudeQuery({
      prompt,
      cwd,
      resume: session.sdkSessionId,
      model: session.model || config.model,
      systemPrompt: buildChatSystemPrompt(),
      abortController,
    });

    if (result.text) {
      for (const chunk of split(result.text)) {
        await sender.sendText(fromUserId, contextToken, chunk);
      }
      sessionStore.addChatMessage(session, 'assistant', result.text);
      logger.info('Idle proactive message sent', { textLength: result.text.length });
    } else if (result.error) {
      logger.error('Idle proactive: claude returned no text', { error: result.error });
    }

    session.sdkSessionId = result.sessionId || session.sdkSessionId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    if (isAbort) logger.info('Idle proactive aborted');
    else logger.error('Idle proactive failed', { error: msg });
  } finally {
    stopTyping();
    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  }
}