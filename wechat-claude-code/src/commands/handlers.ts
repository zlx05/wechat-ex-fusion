import type { CommandContext, CommandResult } from './router.js';
import { scanAllSkills, formatSkillList, findSkill, type SkillInfo } from '../claude/skill-scanner.js';
import { loadConfig, saveConfig } from '../config.js';
import { DEFAULT_WORKING_DIR } from '../constants.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HELP_TEXT = `可用命令：

会话管理：
  /help             显示帮助
  /stop             停止当前对话并清空排队消息
  /clear            清除当前会话
  /reset            完全重置（包括工作目录等设置）
  /status           查看当前会话状态
  /compact          压缩上下文（开始新 SDK 会话，保留历史）
  /history [数量]   查看对话记录（默认最近20条）
  /undo [数量]      撤销最近对话（默认1条）

文件：
  /send <路径>      发送本地文件（图片直接显示，其他文件作为附件）

配置：
  /cwd [路径]       查看或切换工作目录
  /model [名称]     查看或切换 Claude 模型
  /prompt [内容]    查看或设置系统提示词（全局生效）

模式（人设聊天 与 任务 完全隔离，各存各的记忆）：
  /task [内容]     切换到任务模式（中性助手，可跑项目/截图/推文件），后续对话都算任务
  /chat [内容]     切换回聊天模式（前任人设）
  /mode             查看当前模式

人设：
  /update           沉淀最近对话，自动更新前任的人设（后台留版本存档）

其他：
  /skills [full]    列出已安装的 skill（full 显示描述）
  /version          查看版本信息
  /<skill> [参数]   触发已安装的 skill

直接输入文字即可与 Claude Code 对话`;

// 缓存 skill 列表，避免每次命令都扫描文件系统
let cachedSkills: SkillInfo[] | null = null;
let lastScanTime = 0;
const CACHE_TTL = 60_000; // 60秒

function getSkills(): SkillInfo[] {
  const now = Date.now();
  if (!cachedSkills || now - lastScanTime > CACHE_TTL) {
    cachedSkills = scanAllSkills();
    lastScanTime = now;
  }
  return cachedSkills;
}

/** 清除缓存，用于 /skills 命令强制刷新 */
export function invalidateSkillCache(): void {
  cachedSkills = null;
}

export function handleHelp(_args: string): CommandResult {
  return { reply: HELP_TEXT, handled: true };
}

export function handleClear(ctx: CommandContext): CommandResult {
  const newSession = ctx.clearSession();
  Object.assign(ctx.session, newSession);
  const label = ctx.session.mode === 'task' ? '任务' : '聊天';
  return {
    reply: `✅ 已清除当前${label}对话并开新档（另一模式不受影响，旧档留盘可查）。下次消息将开始新会话。`,
    handled: true,
  };
}

export function handleCwd(ctx: CommandContext, args: string): CommandResult {
  const isTask = ctx.session.mode === 'task';
  const currentDir = isTask
    ? (ctx.session.taskWorkingDirectory || ctx.session.workingDirectory)
    : ctx.session.workingDirectory;
  if (!args) {
    const modeLabel = isTask ? '任务模式' : '聊天模式';
    return { reply: `当前模式: ${modeLabel}\n当前工作目录: ${currentDir}\n用法: /cwd <路径>`, handled: true };
  }
  if (isTask) {
    ctx.updateSession({ taskWorkingDirectory: args });
  } else {
    ctx.updateSession({ workingDirectory: args });
  }
  return { reply: `✅ ${isTask ? '任务' : '聊天'}工作目录已切换为: ${args}`, handled: true };
}

/** 进入任务模式：后续对话全走任务会话（中性助手），直到 /chat 切回。带内容则立即在任务模式执行。 */
export function handleTask(ctx: CommandContext, args: string): CommandResult {
  ctx.updateSession({ mode: 'task' });
  if (args) {
    return { handled: true, claudePrompt: args };
  }
  return {
    reply: '⚙️ 已切换到【任务模式】\n\n之后的话都算任务，不会污染 Ta 对你的记忆。可以让我跑项目、看界面、截图、改代码。\n发 /chat 回到 Ta。',
    handled: true,
  };
}

/** 回到聊天模式（人设）。带内容则立即交给人设回复。 */
export function handleChat(ctx: CommandContext, args: string): CommandResult {
  ctx.updateSession({ mode: 'chat' });
  if (args) {
    return { handled: true, claudePrompt: args };
  }
  return { reply: '💬 已回到【聊天模式】', handled: true };
}

export function handleMode(ctx: CommandContext): CommandResult {
  const isTask = ctx.session.mode === 'task';
  return {
    reply: isTask
      ? '⚙️ 当前是【任务模式】（中性助手，动作隔离）\n/task <内容> 继续任务\n/chat 切回 Ta'
      : '💬 当前是【聊天模式】（前任人设）\n/task <内容> 切换到任务模式',
    handled: true,
  };
}

export function handleModel(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    return { reply: '用法: /model <模型名称>\n例: /model claude-sonnet-4-6', handled: true };
  }
  ctx.updateSession({ model: args });
  return { reply: `✅ 模型已切换为: ${args}`, handled: true };
}

export function handleStatus(ctx: CommandContext): CommandResult {
  const s = ctx.session;
  const modeLabel = s.mode === 'task' ? '任务 (⚙️)' : '聊天 (💬)';
  const cwd = s.mode === 'task'
    ? (s.taskWorkingDirectory || s.workingDirectory)
    : s.workingDirectory;
  const sessionId = s.mode === 'task' ? s.taskSdkSessionId : s.sdkSessionId;
  const lines = [
    '📊 会话状态',
    '',
    `模式: ${modeLabel}`,
    `工作目录: ${cwd}`,
    `模型: ${s.model ?? '默认'}`,
    `会话ID: ${sessionId ?? '无'}`,
    `状态: ${s.state}`,
  ];
  return { reply: lines.join('\n'), handled: true };
}

export function handleSkills(args: string): CommandResult {
  invalidateSkillCache();
  const skills = getSkills();
  if (skills.length === 0) {
    return { reply: '未找到已安装的 skill。', handled: true };
  }

  const showFull = args.trim().toLowerCase() === 'full';
  if (showFull) {
    const lines = skills.map(s => `/${s.name}\n   ${s.description}`);
    return { reply: `📋 已安装的 Skill (${skills.length}):\n\n${lines.join('\n\n')}`, handled: true };
  }
  const lines = skills.map(s => `/${s.name}`);
  return { reply: `📋 已安装的 Skill (${skills.length}):\n\n${lines.join('\n')}\n\n使用 /skills full 查看完整描述`, handled: true };
}

const MAX_HISTORY_LIMIT = 100;

export function handleHistory(ctx: CommandContext, args: string): CommandResult {
  const limit = args ? parseInt(args, 10) : 20;
  if (isNaN(limit) || limit <= 0) {
    return { reply: '用法: /history [数量]\n例: /history 50（显示最近50条对话）', handled: true };
  }
  const effectiveLimit = Math.min(limit, MAX_HISTORY_LIMIT);

  const historyText = ctx.getChatHistoryText?.(effectiveLimit) || '暂无对话记录';

  return { reply: `📝 对话记录（最近${effectiveLimit}条）:\n\n${historyText}`, handled: true };
}

/** 完全重置当前模式会话（含工作目录、任务工作目录），另一模式不受影响 */
export function handleReset(ctx: CommandContext): CommandResult {
  const newSession = ctx.clearSession();
  newSession.workingDirectory = DEFAULT_WORKING_DIR;
  newSession.taskWorkingDirectory = DEFAULT_WORKING_DIR;
  ctx.updateSession(newSession);
  return { reply: '✅ 会话已完全重置，所有设置恢复默认。', handled: true };
}

/** 压缩上下文 — 清除当前模式的 SDK 会话 ID，开始新上下文但保留各自的记忆档 */
export function handleCompact(ctx: CommandContext): CommandResult {
  const isTask = ctx.session.mode === 'task';
  const currentSessionId = isTask ? ctx.session.taskSdkSessionId : ctx.session.sdkSessionId;
  if (!currentSessionId) {
    return { reply: 'ℹ️ 当前没有活动的 SDK 会话，无需压缩。', handled: true };
  }
  ctx.updateSession(isTask
    ? { taskPreviousSdkSessionId: currentSessionId, taskSdkSessionId: undefined }
    : { previousSdkSessionId: currentSessionId, sdkSessionId: undefined });
  return {
    reply: `✅ 上下文已压缩（${isTask ? '任务' : '聊天'}模式）\n\n下次消息将开始新的 SDK 会话（token 清零）\n聊天历史已保留，可用 /history 查看`,
    handled: true,
  };
}

/** 撤销当前模式最近 N 条对话 */
export function handleUndo(ctx: CommandContext, args: string): CommandResult {
  const count = args ? parseInt(args, 10) : 1;
  if (isNaN(count) || count <= 0) {
    return { reply: '用法: /undo [数量]\n例: /undo 2（撤销最近2条对话）', handled: true };
  }
  const key = ctx.session.mode === 'task' ? 'taskHistory' : 'chatHistory';
  const history = (ctx.session as any)[key] || [];
  if (history.length === 0) {
    return { reply: `⚠️ 没有对话记录可撤销（当前${ctx.session.mode === 'task' ? '任务' : '聊天'}模式）`, handled: true };
  }
  const actualCount = Math.min(count, history.length);
  (ctx.session as any)[key] = history.slice(0, -actualCount);
  ctx.updateSession({ [key]: (ctx.session as any)[key] } as any);
  return { reply: `✅ 已撤销最近 ${actualCount} 条对话（${ctx.session.mode === 'task' ? '任务' : '聊天'}档）`, handled: true };
}

/** 查看版本信息 */
export function handleVersion(): CommandResult {
  try {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    const version = pkg.version || 'unknown';
    return { reply: `wechat-claude-code v${version}`, handled: true };
  } catch {
    return { reply: 'wechat-claude-code (version unknown)', handled: true };
  }
}

export function handlePrompt(_ctx: CommandContext, args: string): CommandResult {
  const config = loadConfig();
  if (!args) {
    const current = config.systemPrompt;
    if (current) {
      return { reply: `📝 当前系统提示词:\n${current}\n\n用法:\n/prompt <提示词>  — 设置\n/prompt clear   — 清除`, handled: true };
    }
    return { reply: '📝 暂无系统提示词\n\n用法: /prompt <提示词>\n例: /prompt 用中文回答我', handled: true };
  }
  if (args.trim().toLowerCase() === 'clear') {
    config.systemPrompt = undefined;
    saveConfig(config);
    return { reply: '✅ 系统提示词已清除', handled: true };
  }
  config.systemPrompt = args.trim();
  saveConfig(config);
  return { reply: `✅ 系统提示词已设置:\n${config.systemPrompt}`, handled: true };
}

export function handleSend(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    return { reply: '用法: /send <文件路径>\n例: /send ~/Documents/report.pdf\n     /send ./chart.png', handled: true };
  }

  const resolved = args.startsWith('/')
    ? args
    : resolve(ctx.session.workingDirectory, args.replace(/^~/, homedir()));
  if (!existsSync(resolved)) {
    return { reply: `文件不存在: ${resolved}`, handled: true };
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    return { reply: `这是一个目录，请指定文件: ${resolved}`, handled: true };
  }

  if (stat.size > 25 * 1024 * 1024) {
    return { reply: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，最大支持 25MB`, handled: true };
  }

  return { handled: true, sendFile: resolved };
}

export function handleUnknown(cmd: string, args: string): CommandResult {
  const skills = getSkills();
  const skill = findSkill(skills, cmd);

  if (skill) {
    const prompt = args ? `Use the ${skill.name} skill: ${args}` : `Use the ${skill.name} skill`;
    return { handled: true, claudePrompt: prompt };
  }

  return {
    handled: true,
    reply: `未找到 skill: ${cmd}\n输入 /skills 查看可用列表`,
  };
}
