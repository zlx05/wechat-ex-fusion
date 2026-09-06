import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withinQuietWindow,
  randomProactiveDelayMs,
  startIdleProactive,
  type IdleProactiveDeps,
  type SenderLike,
  type SessionStoreLike,
} from '../proactive.js';
import type { Config } from '../config.js';
import type { Session } from '../session.js';
import type { AccountData } from '../wechat/accounts.js';

const base: Config = { workingDirectory: '/tmp' };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(till: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!till()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await sleep(50);
  }
}

function dateAt(hour: number, minute = 0): Date {
  return new Date(2026, 8, 6, hour, minute, 0, 0);
}

// ---------------------------------------------------------------------------
// 静默窗口 / 随机间隔 纯工具
// ---------------------------------------------------------------------------

test('默认静默窗口 23:00–07:00：23 点入窗，7 点出窗', () => {
  assert.equal(withinQuietWindow(dateAt(22, 59), base), false);
  assert.equal(withinQuietWindow(dateAt(23, 0), base), true);
  assert.equal(withinQuietWindow(dateAt(3, 30), base), true);
  assert.equal(withinQuietWindow(dateAt(6, 59), base), true);
  assert.equal(withinQuietWindow(dateAt(7, 0), base), false);
});

test('非跨天窗口 start<end：1:00–6:00', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveQuietStart: 1, idleProactiveQuietEnd: 6 };
  assert.equal(withinQuietWindow(dateAt(0, 59), cfg), false);
  assert.equal(withinQuietWindow(dateAt(1, 0), cfg), true);
  assert.equal(withinQuietWindow(dateAt(5, 59), cfg), true);
  assert.equal(withinQuietWindow(dateAt(6, 0), cfg), false);
});

test('start==end 表示不静默', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveQuietStart: 23, idleProactiveQuietEnd: 23 };
  assert.equal(withinQuietWindow(dateAt(23, 30), cfg), false);
  assert.equal(withinQuietWindow(dateAt(3, 0), cfg), false);
});

test('随机间隔落在 [min,max] 区间', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveMinHours: 2, idleProactiveMaxHours: 4 };
  for (let i = 0; i < 300; i++) {
    const ms = randomProactiveDelayMs(cfg);
    assert.ok(ms >= 2 * 3_600_000, `ms=${ms}`);
    assert.ok(ms < 4 * 3_600_000, `ms=${ms}`);
  }
});

test('min==max 时返回固定值', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveMinHours: 5, idleProactiveMaxHours: 5 };
  for (let i = 0; i < 10; i++) {
    assert.equal(randomProactiveDelayMs(cfg), 5 * 3_600_000);
  }
});

// ---------------------------------------------------------------------------
// 自动发送流程（注入假 query / 假 sender，真实计时）
// ---------------------------------------------------------------------------

function newSession(): Session {
  return {
    mode: 'chat',
    workingDirectory: '/tmp',
    state: 'idle',
    chatHistory: [],
    taskHistory: [],
  };
}

function makeDeps(session: Session, sent: string[], cfgOver: Partial<Config>): IdleProactiveDeps {
  const cfg: Config = {
    workingDirectory: '/tmp',
    systemPrompt: '你是小梦',
    idleProactiveMinHours: 1 / 3600, // 约 1 秒，便于测试
    idleProactiveMaxHours: 1 / 3600,
    idleProactiveQuietStart: 0, // 测试默认不静默，避免被真实时钟干扰
    idleProactiveQuietEnd: 0,
    ...cfgOver,
  };
  const sessionStore: SessionStoreLike = {
    addChatMessage(s, role, content) {
      s.chatHistory!.push({ role, content, timestamp: 0 });
    },
    save() {},
  };
  const sender: SenderLike = {
    async sendText(_to, _ctx, text) { sent.push(text); },
    startTyping() { return () => {}; },
  };
  const account: AccountData = {
    botToken: 'token',
    accountId: 'acc',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    userId: 'u1',
    createdAt: '2026-01-01',
  };
  return {
    account,
    session,
    sessionStore,
    sender,
    loadConfig: () => cfg,
    getLastContextToken: () => 'tok',
    buildChatSystemPrompt: () => '系统提示',
    split: (t) => t.split(/\r?\n/).filter(Boolean),
    query: async () => ({ text: '今天怎么没找我聊呀', sessionId: 's1' }),
  };
}

test('端到端：空闲到点自动发一条、计入历史、状态复原', async () => {
  const session = newSession();
  const sent: string[] = [];
  const idle = startIdleProactive(makeDeps(session, sent, {}));

  await waitFor(() => sent.length > 0, 4000);
  idle.stop(); // 停掉下一轮排程，防止断言期间第二发
  await sleep(80); // 等 finally 把状态落回 idle

  assert.deepEqual(sent, ['今天怎么没找我聊呀']);
  assert.equal(session.chatHistory.length, 1);
  assert.equal(session.chatHistory[0].role, 'assistant');
  assert.equal(session.chatHistory[0].content, '今天怎么没找我聊呀');
  assert.equal(session.state, 'idle');
});

test('收到用户消息(重置)会把发送推迟到新的计时结束', async () => {
  const session = newSession();
  const sent: string[] = [];
  const idle = startIdleProactive(makeDeps(session, sent, {})); // 间隔约 1s

  await sleep(120); // 未到 1s
  idle.reset();     // 模拟用户发消息 → 重新计时
  await sleep(700); // 重置后还不到 1s
  assert.equal(sent.length, 0);

  await waitFor(() => sent.length > 0, 3000); // 重置满 1s 后应发送
  idle.stop();
  assert.equal(sent.length, 1);
});

test('idleProactiveEnabled=false 不发送', async () => {
  const session = newSession();
  const sent: string[] = [];
  const idle = startIdleProactive(makeDeps(session, sent, { idleProactiveEnabled: false }));

  await sleep(1400); // 超过 1s 间隔仍未发生
  idle.stop();
  assert.equal(sent.length, 0);
});

test('目标时间落在静默窗口则本轮不发送（不补发）', async () => {
  const session = newSession();
  const sent: string[] = [];
  const deps = makeDeps(session, sent, { idleProactiveQuietStart: 23, idleProactiveQuietEnd: 7 });
  // 固定在窗口内的 03:00 → now+delay 也必然在窗口 → 不设计时、不发送
  deps.getNow = () => dateAt(3, 0);

  const idle = startIdleProactive(deps);
  await sleep(1400);
  idle.stop();
  assert.equal(sent.length, 0);
});