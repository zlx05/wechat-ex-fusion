import { loadJson, saveJson, validateAccountId } from './store.js';
import { mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { DATA_DIR, DEFAULT_WORKING_DIR } from './constants.js';
import { join } from 'node:path';
import { logger } from './logger.js';

const SESSIONS_DIR = join(DATA_DIR, 'sessions');

export type SessionState = 'idle' | 'processing';
/** 聊天模式 = 人设；任务模式 = 中性助手（/task），两者会话与记忆完全隔离。 */
export type SessionMode = 'chat' | 'task';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Session {
  mode: SessionMode;
  /** 聊天模式 SDK 会话 ID（人设，独立上下文）。 */
  sdkSessionId?: string;
  previousSdkSessionId?: string;
  /** 任务模式 SDK 会话 ID（中性助手，独立上下文，不碰人设）。 */
  taskSdkSessionId?: string;
  taskPreviousSdkSessionId?: string;
  /** 聊天模式工作目录；任务模式缺省时也用它，再回退 config。 */
  workingDirectory: string;
  /** 任务模式工作目录（/task 下 /cwd 修改它），保证任务环境不污染聊天。 */
  taskWorkingDirectory?: string;
  model?: string;
  state: SessionState;
  /** 聊天档案：只存真实 user↔Ta 对话，作为 /update 蒸馏原料，不裁剪。 */
  chatHistory: ChatMessage[];
  /** 任务档案：纯审计用，保留最后 N 条即可。 */
  taskHistory: ChatMessage[];
  maxHistoryLength?: number;
  maxTaskHistoryLength?: number;
  /** 上次 /update 完成时 chatHistory 的长度，作为蒸馏起点（游标）。 */
  chatCursor?: number;
}

/**
 * 磁盘上"一段对话"的形态。按模式分文件：chat 档的 sdkSessionId / workingDirectory 即聊天侧字段，
 * task 档里的同名字段则为任务侧（taskSdkSessionId / taskWorkingDirectory）。绝不写系统回执进来。
 */
interface EpisodeFile {
  mode: SessionMode;
  /** 这段对话的起始时间（文件名的 YYYYMMDD-HHmmss 与之对应）。 */
  startedAt: number;
  sdkSessionId?: string;
  previousSdkSessionId?: string;
  workingDirectory?: string;
  messages: ChatMessage[];
}

/** state.json：账户级指针与全局量，不含对话数据。 */
interface SessionStateFile {
  mode: SessionMode;
  model?: string;
  activeChatFile?: string;
  activeTaskFile?: string;
  chatCursor?: number;
  maxHistoryLength?: number;
  maxTaskHistoryLength?: number;
}

const DEFAULT_MAX_HISTORY = 100;
const DEFAULT_MAX_TASK_HISTORY = 500;

// ---------------------------------------------------------------------------
// 路径 / 时间 helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时间戳，形如 20260904-233800。排序即时间序，且不含 ':' 可安全用作文件名。 */
function timestampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function accountDir(accountId: string): string {
  validateAccountId(accountId);
  return join(SESSIONS_DIR, accountId);
}

function statePath(accountId: string): string {
  return join(accountDir(accountId), 'state.json');
}

function episodePath(accountId: string, fileName: string): string {
  return join(accountDir(accountId), fileName);
}

function modePrefix(mode: SessionMode): string {
  return mode === 'task' ? 'task-' : 'chat-';
}

/** 生成 <mode>-<时间戳>.json；同秒撞名时追加 -1/-2 递增后缀保证唯一。 */
function nextEpisodeFile(accountId: string, mode: SessionMode): string {
  const ts = timestampNow();
  const base = `${modePrefix(mode)}${ts}.json`;
  if (!existsSync(episodePath(accountId, base))) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${modePrefix(mode)}${ts}-${i}.json`;
    if (!existsSync(episodePath(accountId, candidate))) return candidate;
  }
  return base;
}

/** 文件名排序键：定宽时间戳优先，同秒的 -N 后缀视为更晚（无后缀 = seq 0）。 */
function episodeSortKey(name: string): { ts: string; seq: number } {
  const m = /^(\d{8}-\d{6})(?:-(\d+))?\.json$/.exec(name);
  if (!m) return { ts: name, seq: 0 };
  return { ts: m[1], seq: m[2] ? Number(m[2]) : 0 };
}

/** 某模式的当前活动档：优先 state 指针；缺失或被删则回退取同名模式最新时间戳档。 */
function resolveActiveFile(accountId: string, mode: SessionMode, stored?: string): string | null {
  if (stored && existsSync(episodePath(accountId, stored))) return stored;
  const prefix = modePrefix(mode);
  let files: string[];
  try {
    files = readdirSync(accountDir(accountId)).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  } catch {
    files = [];
  }
  files.sort((a, b) => {
    const ka = episodeSortKey(a.slice(prefix.length));
    const kb = episodeSortKey(b.slice(prefix.length));
    return ka.ts === kb.ts ? ka.seq - kb.seq : (ka.ts < kb.ts ? -1 : 1);
  });
  return files.length > 0 ? files[files.length - 1] : null;
}

function emptyEpisode(mode: SessionMode): EpisodeFile {
  return { mode, startedAt: Date.now(), messages: [] };
}

// ---------------------------------------------------------------------------
// 旧单文件迁移
// ---------------------------------------------------------------------------

/**
 * 老版本是一个文件 sessions/<账号>.json（聊天+任务混装）。首次加载时迁入分层目录：
 * 聊天/任务各自成档、state.json 记指针，旧文件改名 .json.legacy 留底，不删除、不丢历史。
 */
function migrateIfLegacy(accountId: string): void {
  const legacy = join(SESSIONS_DIR, `${accountId}.json`);
  if (!existsSync(legacy)) return;

  if (!existsSync(statePath(accountId))) {
    const old = loadJson<Session>(legacy, {
      mode: 'chat',
      workingDirectory: DEFAULT_WORKING_DIR,
      state: 'idle',
      chatHistory: [],
      taskHistory: [],
    });

    const dir = accountDir(accountId);
    mkdirSync(dir, { recursive: true });
    const ts = timestampNow();
    const startedAt = Date.now();

    saveJson(episodePath(accountId, `chat-${ts}.json`), {
      mode: 'chat',
      startedAt,
      sdkSessionId: old.sdkSessionId,
      previousSdkSessionId: old.previousSdkSessionId,
      workingDirectory: old.workingDirectory,
      messages: old.chatHistory ?? [],
    });

    let activeTaskFile: string | undefined;
    if ((old.taskHistory && old.taskHistory.length > 0) || old.taskSdkSessionId) {
      activeTaskFile = `task-${ts}.json`;
      saveJson(episodePath(accountId, activeTaskFile), {
        mode: 'task',
        startedAt,
        sdkSessionId: old.taskSdkSessionId,
        previousSdkSessionId: old.taskPreviousSdkSessionId,
        workingDirectory: old.taskWorkingDirectory,
        messages: old.taskHistory ?? [],
      });
    }

    saveJson(statePath(accountId), {
      mode: old.mode ?? 'chat',
      model: old.model,
      activeChatFile: `chat-${ts}.json`,
      activeTaskFile,
      chatCursor: old.chatCursor,
      maxHistoryLength: old.maxHistoryLength,
      maxTaskHistoryLength: old.maxTaskHistoryLength,
    } satisfies SessionStateFile);

    logger.info('Migrated session to partitioned layout', { accountId });
  }

  // 无论是否本次迁移，都把旧单文件挪到 .legacy，避免它一直残留造成二次加载歧义。
  try { renameSync(legacy, join(SESSIONS_DIR, `${accountId}.json.legacy`)); } catch { /* 挪不动就留着 */ }
}

// ---------------------------------------------------------------------------
// 组回运行时 Session
// ---------------------------------------------------------------------------

function buildSession(accountId: string, state: SessionStateFile): Session {
  const dir = accountDir(accountId);
  const chatFile = resolveActiveFile(accountId, 'chat', state.activeChatFile);
  const taskFile = resolveActiveFile(accountId, 'task', state.activeTaskFile);
  const chatEp = chatFile ? loadJson<EpisodeFile>(episodePath(accountId, chatFile), emptyEpisode('chat')) : emptyEpisode('chat');
  const taskEp = taskFile ? loadJson<EpisodeFile>(episodePath(accountId, taskFile), emptyEpisode('task')) : emptyEpisode('task');

  return {
    mode: state.mode ?? 'chat',
    sdkSessionId: chatEp.sdkSessionId,
    previousSdkSessionId: chatEp.previousSdkSessionId,
    taskSdkSessionId: taskEp.sdkSessionId,
    taskPreviousSdkSessionId: taskEp.previousSdkSessionId,
    workingDirectory: chatEp.workingDirectory || DEFAULT_WORKING_DIR,
    taskWorkingDirectory: taskEp.workingDirectory,
    model: state.model,
    state: 'idle',
    chatHistory: chatEp.messages ?? [],
    taskHistory: taskEp.messages ?? [],
    chatCursor: state.chatCursor,
    maxHistoryLength: state.maxHistoryLength || DEFAULT_MAX_HISTORY,
    maxTaskHistoryLength: state.maxTaskHistoryLength || DEFAULT_MAX_TASK_HISTORY,
  };
}

export function createSessionStore() {
  function load(accountId: string): Session {
    migrateIfLegacy(accountId);
    const state = loadJson<SessionStateFile>(statePath(accountId), { mode: 'chat' });
    return buildSession(accountId, state);
  }

  /**
   * 持久化当前 Session。写 state.json + 当前模式的活动档；同时把另一模式的档也同步一次，
   * 保证跨模式改动（如 /cwd、/reset 改工作目录）在切换后仍一致。
   */
  function save(accountId: string, session: Session): void {
    validateAccountId(accountId);
    const dir = accountDir(accountId);
    mkdirSync(dir, { recursive: true });
    const state = loadJson<SessionStateFile>(statePath(accountId), { mode: session.mode });

    // 任务档是纯审计，裁剪到上限；聊天档不裁剪（/update 蒸馏原料）。
    const maxTaskLen = session.maxTaskHistoryLength || DEFAULT_MAX_TASK_HISTORY;
    if (session.taskHistory.length > maxTaskLen) {
      session.taskHistory = session.taskHistory.slice(-maxTaskLen);
    }

    const writeEpisode = (mode: SessionMode): void => {
      const activeFile = resolveActiveFile(accountId, mode, mode === 'task' ? state.activeTaskFile : state.activeChatFile)
        ?? nextEpisodeFile(accountId, mode);
      const existing = existsSync(episodePath(accountId, activeFile))
        ? loadJson<EpisodeFile>(episodePath(accountId, activeFile), emptyEpisode(mode))
        : null;

      saveJson(episodePath(accountId, activeFile), {
        mode,
        startedAt: existing?.startedAt ?? Date.now(),
        sdkSessionId: mode === 'task' ? session.taskSdkSessionId : session.sdkSessionId,
        previousSdkSessionId: mode === 'task' ? session.taskPreviousSdkSessionId : session.previousSdkSessionId,
        workingDirectory: mode === 'task' ? session.taskWorkingDirectory : session.workingDirectory,
        messages: mode === 'task' ? session.taskHistory : session.chatHistory,
      } satisfies EpisodeFile);

      if (mode === 'task') state.activeTaskFile = activeFile;
      else state.activeChatFile = activeFile;
    };

    writeEpisode(session.mode);
    writeEpisode(session.mode === 'task' ? 'chat' : 'task');

    state.mode = session.mode;
    state.model = session.model;
    state.chatCursor = session.chatCursor;
    state.maxHistoryLength = session.maxHistoryLength;
    state.maxTaskHistoryLength = session.maxTaskHistoryLength;
    saveJson(statePath(accountId), state);
  }

  /**
   * 只清当前模式：该模式开新档（时间戳文件名）、历史与 Claude SDK 会话清空、聊天档的 /update
   * 游标归零；另一模式的对话与设置从磁盘原样读回，不受影响。旧档留盘可查。
   */
  function clear(accountId: string, mode: SessionMode = 'chat'): Session {
    validateAccountId(accountId);
    const dir = accountDir(accountId);
    mkdirSync(dir, { recursive: true });
    const state = loadJson<SessionStateFile>(statePath(accountId), { mode });

    const curFile = resolveActiveFile(accountId, mode, mode === 'task' ? state.activeTaskFile : state.activeChatFile);
    const curEp = curFile ? loadJson<EpisodeFile>(episodePath(accountId, curFile), emptyEpisode(mode)) : null;

    // 工作目录属于"设置"而非"对话"，跨 clear 沿用；SDK 会话与历史是对话，清空。
    const newFile = nextEpisodeFile(accountId, mode);
    saveJson(episodePath(accountId, newFile), {
      mode,
      startedAt: Date.now(),
      workingDirectory: curEp?.workingDirectory,
      messages: [],
    } satisfies EpisodeFile);

    if (mode === 'task') state.activeTaskFile = newFile;
    else {
      state.activeChatFile = newFile;
      state.chatCursor = undefined; // 聊天档重新开始，/update 蒸馏从新档起算
    }
    state.mode = mode;
    saveJson(statePath(accountId), state);

    return buildSession(accountId, state);
  }

  function activeHistory(session: Session): ChatMessage[] {
    return session.mode === 'task' ? session.taskHistory : session.chatHistory;
  }

  function addChatMessage(session: Session, role: 'user' | 'assistant', content: string): void {
    if (session.mode === 'task') {
      if (!session.taskHistory) session.taskHistory = [];
      session.taskHistory.push({ role, content, timestamp: Date.now() });
      const maxTaskLen = session.maxTaskHistoryLength || DEFAULT_MAX_TASK_HISTORY;
      if (session.taskHistory.length > maxTaskLen) {
        session.taskHistory = session.taskHistory.slice(-maxTaskLen);
      }
      return;
    }

    if (!session.chatHistory) session.chatHistory = [];
    session.chatHistory.push({ role, content, timestamp: Date.now() });
    // 聊天档案不裁剪——它是 /update 蒸馏的原料。
  }

  function getChatHistoryText(session: Session, limit?: number): string {
    const history = activeHistory(session);
    const messages = limit ? history.slice(-limit) : history;
    const modeLabel = session.mode === 'task' ? '任务' : '聊天';

    if (messages.length === 0) {
      return `暂无对话记录（当前${modeLabel}模式）`;
    }

    const lines: string[] = [];
    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      const role = msg.role === 'user' ? '用户' : 'Claude';
      lines.push(`[${time}] ${role}:`);
      lines.push(msg.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  return { load, save, clear, addChatMessage, getChatHistoryText };
}