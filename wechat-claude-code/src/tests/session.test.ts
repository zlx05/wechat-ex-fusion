import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// WCC_DATA_DIR 必须在 import session.js 之前设置（SESSIONS_DIR 在模块加载时计算）。
const ROOT = mkdtempSync(join(tmpdir(), 'wcc-sess-'));
process.env.WCC_DATA_DIR = ROOT;

const S = await import('../session.js');
const SESSIONS = join(ROOT, 'sessions');

after(() => rmSync(ROOT, { recursive: true, force: true }));

function cleanup(accountId: string): void {
  rmSync(join(SESSIONS, accountId), { recursive: true, force: true });
  rmSync(join(SESSIONS, `${accountId}.json`), { force: true });
  rmSync(join(SESSIONS, `${accountId}.json.legacy`), { force: true });
}

function listEpisodes(accountId: string, mode: 'chat' | 'task'): string[] {
  const dir = join(SESSIONS, accountId);
  if (!existsSync(dir)) return [];
  const prefix = mode === 'task' ? 'task-' : 'chat-';
  return readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
}

function readEp(accountId: string, file: string): any {
  return JSON.parse(readFileSync(join(SESSIONS, accountId, file), 'utf-8'));
}

test('迁移：旧单文件迁入分层目录，数据完整，.legacy 留底', () => {
  const id = 'mig1';
  cleanup(id);
  mkdirSync(SESSIONS, { recursive: true });
  writeFileSync(join(SESSIONS, `${id}.json`), JSON.stringify({
    mode: 'chat',
    sdkSessionId: 'chat-sess-1',
    taskSdkSessionId: 'task-sess-1',
    workingDirectory: 'E:\\work',
    taskWorkingDirectory: 'E:\\tasks',
    model: 'claude-sonnet-4-6',
    state: 'idle',
    chatHistory: [
      { role: 'user', content: '好几年没见', timestamp: 1 },
      { role: 'assistant', content: '是呗', timestamp: 2 },
    ],
    taskHistory: [{ role: 'user', content: 'task1', timestamp: 3 }],
    chatCursor: 1,
    maxHistoryLength: 50,
    maxTaskHistoryLength: 200,
  }));

  const store = S.createSessionStore();
  const s = store.load(id);

  assert.equal(s.mode, 'chat');
  assert.equal(s.sdkSessionId, 'chat-sess-1');
  assert.equal(s.taskSdkSessionId, 'task-sess-1');
  assert.equal(s.model, 'claude-sonnet-4-6');
  assert.equal(s.workingDirectory, 'E:\\work');
  assert.equal(s.taskWorkingDirectory, 'E:\\tasks');
  assert.equal(s.chatHistory.length, 2);
  assert.equal(s.taskHistory.length, 1);
  assert.equal(s.chatCursor, 1);

  // 旧文件改名留底，新目录结构出现
  assert.ok(!existsSync(join(SESSIONS, `${id}.json`)));
  assert.ok(existsSync(join(SESSIONS, `${id}.json.legacy`)));
  assert.ok(existsSync(join(SESSIONS, id, 'state.json')));
  assert.equal(listEpisodes(id, 'chat').length, 1);
  assert.equal(listEpisodes(id, 'task').length, 1);

  // 二次加载不重复迁移 / 不新建文件
  store.load(id);
  assert.equal(listEpisodes(id, 'chat').length, 1);
  assert.equal(listEpisodes(id, 'task').length, 1);
});

test('分区：聊天与任务各存各档，互不串', () => {
  const id = 'pt1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);

  store.addChatMessage(s, 'user', '今天好吗');
  store.addChatMessage(s, 'assistant', '还行呗');
  store.save(id, s);

  s.mode = 'task';
  store.addChatMessage(s, 'user', '帮我跑个脚本');
  store.addChatMessage(s, 'assistant', '好了');
  store.save(id, s);

  assert.equal(listEpisodes(id, 'chat').length, 1);
  assert.equal(listEpisodes(id, 'task').length, 1);

  const reloaded = store.load(id);
  assert.equal(reloaded.chatHistory.length, 2);
  assert.equal(reloaded.chatHistory[0].content, '今天好吗');
  assert.equal(reloaded.taskHistory.length, 2);
  assert.equal(reloaded.taskHistory[0].content, '帮我跑个脚本');
});

test('切模式延续：同模式文件与 SDK 会话不变，不新建档', () => {
  const id = 'tog1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);

  store.addChatMessage(s, 'user', 'a');
  store.save(id, s);
  const chatFile0 = listEpisodes(id, 'chat')[0];
  s.sdkSessionId = 'chat-sdk-9';
  store.save(id, s);

  s.mode = 'task';
  store.addChatMessage(s, 'user', 't');
  store.save(id, s);

  // 切回聊天：同一个档，SDK 会话延续
  s.mode = 'chat';
  store.addChatMessage(s, 'user', 'b');
  store.save(id, s);

  assert.equal(listEpisodes(id, 'chat').length, 1);
  assert.equal(listEpisodes(id, 'chat')[0], chatFile0);
  const reloaded = store.load(id);
  assert.equal(reloaded.chatHistory.length, 2);
  assert.equal(reloaded.sdkSessionId, 'chat-sdk-9');
  assert.equal(reloaded.taskHistory.length, 1);
});

test('/clear 只清当前模式：聊天开新档，任务档原样保留', () => {
  const id = 'clr1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);

  store.addChatMessage(s, 'user', 'chat-a');
  store.save(id, s);
  s.mode = 'task';
  store.addChatMessage(s, 'user', 'task-a');
  store.save(id, s);
  const taskFilesBefore = listEpisodes(id, 'task');

  s.mode = 'chat';
  const cleared = store.clear(id, 'chat');

  assert.equal(cleared.chatHistory.length, 0);
  assert.equal(cleared.taskHistory.length, 1);
  assert.equal(listEpisodes(id, 'chat').length, 2, '旧+新两个聊天档');
  assert.deepEqual(listEpisodes(id, 'task'), taskFilesBefore, '任务档未动');
  const chatMsgTotal = listEpisodes(id, 'chat').reduce((n, f) => n + readEp(id, f).messages.length, 0);
  assert.equal(chatMsgTotal, 1, '只有旧聊天档还留消息，新档为空');

  const reloaded = store.load(id);
  assert.equal(reloaded.chatHistory.length, 0);
  assert.equal(reloaded.taskHistory.length, 1);
});

test('/clear 只清当前模式：切到任务再 clear，聊天档原样保留', () => {
  const id = 'clr2';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);

  store.addChatMessage(s, 'user', 'chat-a');
  store.save(id, s);
  const chatFilesBefore = listEpisodes(id, 'chat');

  s.mode = 'task';
  store.addChatMessage(s, 'user', 'task-a');
  store.save(id, s);
  s = store.clear(id, 'task');

  assert.equal(s.chatHistory.length, 1, '聊天历史未受影响');
  assert.equal(s.taskHistory.length, 0);
  assert.deepEqual(listEpisodes(id, 'chat'), chatFilesBefore, '聊天档未动');
  assert.equal(listEpisodes(id, 'task').length, 2, '任务旧+新档');
});

test('连续 /clear 生成带时间戳的独立文件（不撞名）', () => {
  const id = 'uni1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);

  for (let i = 0; i < 3; i++) {
    s = store.clear(id, 'chat');
    store.addChatMessage(s, 'user', `msg${i}`);
    store.save(id, s);
  }

  const files = listEpisodes(id, 'chat');
  assert.equal(files.length, 3, '3 次 clear = 3 个档，无多余空档');
  for (const f of files) {
    assert.ok(/^chat-\d{8}-\d{6}(-\d+)?\.json$/.test(f), `文件名带时间戳: ${f}`);
    assert.equal(readEp(id, f).messages.length, 1, `${f} 各含一条消息`);
  }
  assert.equal(new Set(files).size, files.length, '文件名不重复');
});

test('state 指针缺失时，回退按时间取最新档（同秒 -N 后缀也能排对）', () => {
  const id = 'fallback1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);
  s = store.clear(id, 'chat');
  store.addChatMessage(s, 'user', 'first');
  store.save(id, s);
  // 制造同秒 -N 后缀的新档，再删掉 state 指针，验证回退挑中最新的那个档
  const files = listEpisodes(id, 'chat');
  s = store.clear(id, 'chat');
  store.addChatMessage(s, 'user', 'second');
  store.save(id, s);
  rmSync(join(SESSIONS, id, 'state.json'), { force: true });

  const reloaded = store.load(id);
  assert.equal(reloaded.chatHistory.some((m: any) => m.content === 'second'), true, '回退档含最新消息');
});

test('保存时保留对话起始时间（startedAt 不自每次保存刷新）', () => {
  const id = 'start1';
  cleanup(id);
  const store = S.createSessionStore();
  let s = store.load(id);
  store.addChatMessage(s, 'user', 'first');
  store.save(id, s);
  const startedAt0 = readEp(id, listEpisodes(id, 'chat')[0]).startedAt;

  store.addChatMessage(s, 'user', 'second');
  store.save(id, s);
  assert.equal(readEp(id, listEpisodes(id, 'chat')[0]).startedAt, startedAt0);
});

test('任务档裁剪到上限（聊天档不裁剪）', () => {
  const id = 'trim1';
  cleanup(id);
  const store = S.createSessionStore();
  const s = store.load(id);
  s.mode = 'task';
  s.maxTaskHistoryLength = 3;
  for (let i = 0; i < 5; i++) store.addChatMessage(s, 'user', `t${i}`);
  store.save(id, s);

  assert.equal(s.taskHistory.length, 3);
  const reloaded = store.load(id);
  assert.equal(reloaded.taskHistory.length, 3);
  assert.equal(reloaded.taskHistory[0].content, 't2', '保留最后3条');

  // 聊天档永不裁剪
  const c = store.load(id);
  c.mode = 'chat';
  for (let i = 0; i < 10; i++) store.addChatMessage(c, 'user', `c${i}`);
  store.save(id, c);
  assert.equal(c.chatHistory.length, 10);
  assert.equal(store.load(id).chatHistory.length, 10);
});

test('getChatHistoryText / addChatMessage 行为不变', () => {
  const id = 'hist1';
  cleanup(id);
  const store = S.createSessionStore();
  const s = store.load(id);
  store.addChatMessage(s, 'user', 'hi');
  store.addChatMessage(s, 'assistant', 'hello');

  const text = store.getChatHistoryText(s, 20);
  assert.ok(text.includes('用户'));
  assert.ok(text.includes('Claude'));
  assert.ok(text.includes('hi'));
  assert.ok(text.includes('hello'));
  assert.match(text, /\d{4}\/\d{1,2}\/\d{1,2}/, '带本地时间');

  const empty = store.load('hist-empty');
  assert.ok(store.getChatHistoryText(empty, 20).includes('暂无对话记录'));
});