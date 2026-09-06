import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, DEFAULT_WORKING_DIR } from "./constants.js";

export interface Config {
  workingDirectory: string;
  /** 任务模式（/task）下的工作目录，缺省回退到 workingDirectory。 */
  taskWorkingDirectory?: string;
  model?: string;
  /** 聊天模式（人设）系统提示词——由 /update 与 sync 写入。 */
  systemPrompt?: string;
  /** 任务模式系统提示词，缺省用 DEFAULT_TASK_SYSTEM_PROMPT。 */
  taskSystemPrompt?: string;
  /** 主动消息：聊天空闲后自动按人设发一条。默认开启（字段缺省即为开）。 */
  idleProactiveEnabled?: boolean;
  /** 主动消息随机间隔下限（小时）。 */
  idleProactiveMinHours?: number;
  /** 主动消息随机间隔上限（小时）。 */
  idleProactiveMaxHours?: number;
  /** 静默维护窗口起点（小时 0-23，含），此区间不发主动消息。 */
  idleProactiveQuietStart?: number;
  /** 静默维护窗口终点（小时 0-23，不含）。默认 23:00–07:00。 */
  idleProactiveQuietEnd?: number;
}

const CONFIG_PATH = join(DATA_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  workingDirectory: DEFAULT_WORKING_DIR,
};

export function loadConfig(): Config {
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content);
    const config: Config = {
      workingDirectory: parsed.workingDirectory || DEFAULT_CONFIG.workingDirectory,
      taskWorkingDirectory: parsed.taskWorkingDirectory,
      model: parsed.model,
      systemPrompt: parsed.systemPrompt,
      taskSystemPrompt: parsed.taskSystemPrompt,
      idleProactiveEnabled: parsed.idleProactiveEnabled,
      idleProactiveMinHours: parsed.idleProactiveMinHours,
      idleProactiveMaxHours: parsed.idleProactiveMaxHours,
      idleProactiveQuietStart: parsed.idleProactiveQuietStart,
      idleProactiveQuietEnd: parsed.idleProactiveQuietEnd,
    };
    mkdirSync(config.workingDirectory, { recursive: true });
    return config;
  } catch {
    const config = { ...DEFAULT_CONFIG };
    mkdirSync(config.workingDirectory, { recursive: true });
    return config;
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const data: Record<string, unknown> = {
    workingDirectory: config.workingDirectory,
  };
  if (config.taskWorkingDirectory) data.taskWorkingDirectory = config.taskWorkingDirectory;
  if (config.model) data.model = config.model;
  if (config.systemPrompt) data.systemPrompt = config.systemPrompt;
  if (config.taskSystemPrompt) data.taskSystemPrompt = config.taskSystemPrompt;
  if (typeof config.idleProactiveEnabled === 'boolean') data.idleProactiveEnabled = config.idleProactiveEnabled;
  if (typeof config.idleProactiveMinHours === 'number') data.idleProactiveMinHours = config.idleProactiveMinHours;
  if (typeof config.idleProactiveMaxHours === 'number') data.idleProactiveMaxHours = config.idleProactiveMaxHours;
  if (typeof config.idleProactiveQuietStart === 'number') data.idleProactiveQuietStart = config.idleProactiveQuietStart;
  if (typeof config.idleProactiveQuietEnd === 'number') data.idleProactiveQuietEnd = config.idleProactiveQuietEnd;
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  if (process.platform !== "win32") {
    chmodSync(CONFIG_PATH, 0o600);
  }
}