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
  const data: Record<string, string> = {
    workingDirectory: config.workingDirectory,
  };
  if (config.taskWorkingDirectory) data.taskWorkingDirectory = config.taskWorkingDirectory;
  if (config.model) data.model = config.model;
  if (config.systemPrompt) data.systemPrompt = config.systemPrompt;
  if (config.taskSystemPrompt) data.taskSystemPrompt = config.taskSystemPrompt;
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  if (process.platform !== "win32") {
    chmodSync(CONFIG_PATH, 0o600);
  }
}