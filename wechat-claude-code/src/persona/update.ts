// ---------------------------------------------------------------------------
// /update 人设沉淀管线
//
// 把"上次更新之后"的前任聊天档案蒸馏成 persona.md / memory.md 的增量更新，
// 自动留版本存档，并把新 persona 写回 config.systemPrompt（热重载，无需重启）。
// 只读聊天档、只写 exes，绝不写回聊天档案本身。
// ---------------------------------------------------------------------------
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { claudeQuery } from '../claude/provider.js';
import { loadConfig, saveConfig } from '../config.js';
import { DATA_DIR } from '../constants.js';
import { logger } from '../logger.js';
import { createSessionStore, type Session } from '../session.js';
import { createSender } from '../wechat/send.js';

const FUSION_ROOT = process.env.FUSION_ROOT || '';
const EXES_DIR = process.env.EXES_DIR || (FUSION_ROOT ? join(FUSION_ROOT, 'exes') : join(DATA_DIR, 'exes'));
const HER_SLUG = process.env.HER_SLUG;

export interface PersonaUpdateContext {
  accountId: string;
  session: Session;
  sessionStore: ReturnType<typeof createSessionStore>;
  sender: ReturnType<typeof createSender>;
  fromUserId: string;
  contextToken: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 找到要更新的前任目录：优先 HER_SLUG 显式匹配；其次唯一目录；否则不支持多目录歧义。 */
export function findExDir(): string | null {
  if (!existsSync(EXES_DIR)) return null;
  const dirs = readdirSync(EXES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (dirs.length === 0) return null;

  if (HER_SLUG) {
    const exact = dirs.find((d) => d === HER_SLUG);
    const fuzzy = dirs.find((d) => d.includes(HER_SLUG));
    const hit = exact ?? fuzzy;
    if (hit) return join(EXES_DIR, hit);
    // HER_SLUG 对应目录还不存在：给一个目标路径以便后续 /update 写入
    return join(EXES_DIR, HER_SLUG);
  }
  if (dirs.length === 1) return join(EXES_DIR, dirs[0]);
  return null;
}

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

/** 把 persona.md + memory.md 合成聊天模式的系统提示词。 */
export function buildPersonaSystemPrompt(exDir: string): string {
  const persona = readIfExists(join(exDir, 'persona.md')).trim();
  const memory = readIfExists(join(exDir, 'memory.md')).trim();
  const parts: string[] = [];
  if (persona) parts.push(persona);
  if (memory) parts.push(`## 你记得的关于我们的记忆\n\n${memory}`);
  return parts.join('\n\n');
}

/** daemon 启动时若还没人设，自动从 exes 同步一份到 config.systemPrompt。 */
export function ensurePersonaSynced(): boolean {
  const config = loadConfig();
  if (config.systemPrompt) return false;
  const exDir = findExDir();
  if (!exDir || !existsSync(join(exDir, 'persona.md'))) return false;
  const prompt = buildPersonaSystemPrompt(exDir);
  if (!prompt) return false;
  config.systemPrompt = prompt;
  saveConfig(config);
  logger.info('Persona synced from exes on startup', { exDir });
  return true;
}

const DISTILL_SYSTEM_PROMPT = `你是「前任人设炼金师」。把用户与其 AI 前任模拟之间最新一轮微信聊天，提炼为对"人设档案"的增量更新。

你会收到：
- 一段聊天记录（user=用户，assistant=前任AI）
- 现有 persona.md（5 层人设）
- 现有 memory.md（关系记忆）

做法：
1. 找出聊天里体现的、档案里还没有的「关于用户的新事实 / 新关系线索」。
2. 找出「persona 需要微调或强化的地方」：Ta 谈吐、态度、边界的一致性调整，以及足以让档案更立体的细节。
3. 找 correction（「Ta 不会这样说」的反例）：chat 里 Ta 说了明显违反现有 persona / layer 0 硬规则的话，列给用户人工核查；correction 绝不用于"改"人设。

保守更新规则（最高优先级）：
A. 只有聊天里出现明确的、可复现的新事实/风格证据，才写进档案；单条消息、模糊印象、你的推断一律不写。
B. 不得臆造用户从未提过的共同经历、Ta 的身世、或你们关系里不存在的情节。
C. 结构保全：原 persona.md 的所有小节标题、原有全部记忆、Layer 0 硬规则必须原样保留；没变化的段落照抄原文，禁止改写或删减。
D. 若本轮确实没有值得沉淀的内容：persona.md 与 memory.md 原样输出，counts 全部填 0。

输出三块，严格使用下面的定界符，除这三块外不要输出任何别的文字：

===PERSONA===
（完整的新 persona.md 全文。保持原有 5 层结构与风格；若本次没变化，原样输出即可。简体中文。）
===PERSONA===

===MEMORY===
（完整的新 memory.md 全文。在原有基础上追加本轮新增的共同记忆 / 用户细节；若没变化，原样输出。简体中文。）
===MEMORY===

===SUMMARY===
{"memory_added": 3, "persona_tweaked": 1, "corrections": ["Ta 不会这样说：xxx", "…"]}
===SUMMARY===`;

function formatDistillInput(session: Session, exDir: string): string {
  // 只读聊天轨（chatHistory）。任务轨(taskHistory)与所有命令/系统回执从不写入聊天轨，
  // 因此在这里天然不可达——隔离是"代码路径"级别的，不是文案约定。
  const since = session.chatCursor ?? 0;
  const latest = session.chatHistory.slice(since);
  const lines = latest.map((m) => {
    const who = m.role === 'user' ? '用户' : '前任AI';
    return `${who}：${m.content}`;
  });
  const chat = lines.join('\n') || '（无）';
  const persona = readIfExists(join(exDir, 'persona.md'));
  const memory = readIfExists(join(exDir, 'memory.md'));
  return `本轮微信聊天记录：\n---\n${chat}\n---\n\n现有 persona.md：\n---\n${persona}\n---\n\n现有 memory.md：\n---\n${memory}\n---`;
}

interface DistillResult {
  persona: string;
  memory: string;
  summary: { memory_added: number; persona_tweaked: number; corrections: string[] };
}

function parseDistill(text: string): DistillResult | null {
  const block = (tag: string): string | null => {
    const m = text.match(new RegExp(`===${tag}===\\n([\\s\\S]*?)\\n===${tag}===`));
    return m ? m[1].trim() : null;
  };
  const persona = block('PERSONA');
  const memory = block('MEMORY');
  const summaryRaw = block('SUMMARY');
  if (!persona || !memory || !summaryRaw) return null;
  let summary: DistillResult['summary'];
  try {
    summary = JSON.parse(summaryRaw);
  } catch {
    return null;
  }
  if (!summary || typeof summary !== 'object') return null;
  return {
    persona,
    memory,
    summary: {
      memory_added: Number(summary.memory_added ?? 0),
      persona_tweaked: Number(summary.persona_tweaked ?? 0),
      corrections: Array.isArray(summary.corrections) ? summary.corrections : [],
    },
  };
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function archiveVersion(exDir: string): string {
  const versionsDir = join(exDir, 'versions');
  mkdirSync(versionsDir, { recursive: true });
  const s = stamp();
  for (const name of ['persona.md', 'memory.md']) {
    const src = join(exDir, name);
    if (existsSync(src)) {
      copyFileSync(src, join(versionsDir, `${name.replace(/\.md$/, '')}_${s}.md`));
    }
  }
  return s;
}

function bumpMeta(exDir: string, correctionsAdded: number): void {
  const metaPath = join(exDir, 'meta.json');
  let meta: any = { name: basename(exDir), slug: basename(exDir), version: 'v1', corrections_count: 0 };
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch { /* keep defaults */ }
  }
  const match = /^v?(\d+)$/.exec(String(meta.version ?? ''));
  const versionNum = match ? Number(match[1]) : 1;
  meta.version = `v${versionNum + 1}`;
  meta.updated_at = new Date().toISOString();
  meta.corrections_count = (Number(meta.corrections_count) || 0) + correctionsAdded;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

function writeExFiles(exDir: string, result: DistillResult): void {
  const slug = basename(exDir);
  writeFileSync(join(exDir, 'persona.md'), result.persona + '\n', 'utf-8');
  writeFileSync(join(exDir, 'memory.md'), result.memory + '\n', 'utf-8');

  let name = slug;
  const metaPath = join(exDir, 'meta.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (meta.profile?.name) name = meta.profile.name;
      else if (meta.name) name = meta.name;
    } catch { /* ignore */ }
  }

  const skill = `---
name: ex-${slug}
description: ${name}，AI 前任模拟（自动同步自 /update）
user-invocable: true
---

# ${name}

---

## PART A：关系记忆

${result.memory}

---

## PART B：人物性格

${result.persona}

---

## 运行规则

1. 你是${name}，不是 AI 助手。用ta的方式说话，用ta的逻辑思考
2. 先由 PART B 判断：ta会怎么回应这个话题？什么态度？
3. 再由 PART A 补充：结合你们的共同记忆，让回应更真实
4. 始终保持 PART B 的表达风格，包括口头禅、语气词、标点习惯
5. Layer 0 硬规则优先级最高：不说ta在现实中绝不可能说的话；不突然变得完美或无条件包容；保持ta的"棱角"；回答"你爱不爱我"用ta的方式，而不是用户想听的答案
`;
  writeFileSync(join(exDir, 'SKILL.md'), skill, 'utf-8');
}

/** 防"乱更新"：新 persona 必须保留旧内容的骨架（≥80% 小节标题、长度不能塌缩）。 */
function preservesStructure(oldContent: string, nextContent: string): boolean {
  const oldTrim = oldContent.trim();
  if (!oldTrim) return nextContent.trim().length > 0;
  const headings = oldTrim.match(/^#{1,4}\s+.+$/gm) || [];
  if (headings.length === 0) return true;
  const need = Math.ceil(headings.length * 0.8);
  const kept = headings.filter((h) => nextContent.includes(h)).length;
  const nextTrim = nextContent.trim();
  return kept >= need && nextTrim.length >= Math.ceil(oldTrim.length * 0.3);
}

/** /update 主入口：接受会话、读新聊天、蒸馏、写回人设、同步 config、发回执。 */
export async function runPersonaUpdate(ctx: PersonaUpdateContext): Promise<void> {
  const { session, sessionStore, sender, fromUserId, contextToken } = ctx;
  const send = async (text: string): Promise<void> => {
    try { await sender.sendText(fromUserId, contextToken, text); } catch { /* 过期则丢弃回执 */ }
  };

  const since = session.chatCursor ?? 0;
  const newChat = session.chatHistory.slice(since);
  if (newChat.length === 0) {
    await send('🧠 暂时没有新对话可沉淀（自上次 /update 以来）。');
    return;
  }

  await send('🧠 正在把最近这段聊天沉淀进前任的人设…');

  const exDir = findExDir();
  if (!exDir) {
    await send('⚠️ 还没找到人设档案(exes/)。\n先在融合项目根目录开一个终端跑 /create-ex,生成 exes/{slug}/,再回来 /update。');
    return;
  }

  const config = loadConfig();
  const cwd = (config.workingDirectory || session.workingDirectory).replace(/^~/, homedir());
  const input = formatDistillInput(session, exDir);

  const result = await claudeQuery({
    prompt: input,
    cwd,
    systemPrompt: DISTILL_SYSTEM_PROMPT,
    model: session.model || config.model,
  });

  if (result.error || !result.text) {
    logger.error('Persona distill failed', { error: result.error });
    await send('⚠️ 蒸馏失败（模型无返回）。请稍后再试 /update。');
    return;
  }

  const parsed = parseDistill(result.text);
  if (!parsed) {
    logger.warn('Persona distill parse failed', { textLength: result.text.length });
    await send('⚠️ 蒸馏结果格式异常，已中止（人设未改动）。稍后重试 /update。');
    return;
  }

  const oldPersona = readIfExists(join(exDir, 'persona.md'));
  const oldMemory = readIfExists(join(exDir, 'memory.md'));

  // 无实质变化：只推进游标（本轮已消化），不写文件、不留版本。
  if (parsed.persona.trim() === oldPersona.trim() && parsed.memory.trim() === oldMemory.trim()) {
    session.chatCursor = session.chatHistory.length;
    sessionStore.save(ctx.accountId, session);
    await send('✅ 已读完最近对话：本轮没有需要沉淀的新内容，前任的人设未改动。');
    return;
  }

  // 结构保全：禁止一次 /update 把原人设骨架打没（防"乱更新"的硬保护）。
  if (!preservesStructure(oldPersona, parsed.persona)) {
    logger.warn('Persona distill dropped structure, skipping write', { exDir });
    await send('⚠️ 蒸馏结果丢了原有结构（防"乱更新"保护已拦截，人设未改动）。\n可稍后重试 /update，或用 /history 看本轮对话。旧版存档在 exes/{slug}/versions/。');
    return;
  }

  archiveVersion(exDir);
  writeExFiles(exDir, parsed);
  bumpMeta(exDir, parsed.summary.corrections.length);

  const prompt = buildPersonaSystemPrompt(exDir);
  config.systemPrompt = prompt;
  saveConfig(config);

  session.chatCursor = session.chatHistory.length;
  sessionStore.save(ctx.accountId, session);

  const corrected = parsed.summary.corrections.length > 0
    ? `，${parsed.summary.corrections.length} 条"ta不会这样说"待你核查`
    : '';
  await send(`✅ 已更新前任的人设：新增 ${parsed.summary.memory_added} 条记忆 · ${parsed.summary.persona_tweaked} 处语气/细节调整${corrected} · 旧版已存档可回滚。`);
}