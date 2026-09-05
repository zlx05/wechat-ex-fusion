import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.WCC_DATA_DIR || join(homedir(), '.wechat-claude-code');

/** 融合项目根目录（由启动 bat 注入）。未通过 bat 启动时为空字符串。 */
export const FUSION_ROOT = process.env.FUSION_ROOT || '';

/**
 * 默认工作目录：优先自动创建在融合项目根目录（记录随项目走，git 克隆即用）；
 * 未通过 bat 启动（无 FUSION_ROOT）时回退到用户文档目录。
 */
export const DEFAULT_WORKING_DIR = FUSION_ROOT
  ? join(FUSION_ROOT, 'her', 'work')
  : join(homedir(), 'Documents', 'ClaudeCode');

/** 任务模式（/task）下使用的系统提示词——中性助手，可跑项目/截图/改代码，不继承人设。 */
export const DEFAULT_TASK_SYSTEM_PROMPT = `你是一个可靠的中文任务助手，现在通过微信与用户交流（不是在命令行终端里工作）。

这里是「任务模式」，独立于人设聊天会话：用户会让你查看/修改项目代码、运行服务与脚本、截图查看界面、生成文件等。

要求：
- 自由使用工具、Bash、读写文件来完成任务，不要让用户去终端操作。
- 如果用户想「看」前端/界面设计，请把项目跑起来并截图保存为 PNG，然后在回复里输出图片的绝对路径，系统会自动把图片推送到用户微信。
- 需要交付文件时，直接输出文件的绝对路径（文件会被自动识别并推送给用户微信）。
- 保持简洁、专业，直接给结果与关键信息，不要扮演任何角色、不要用亲密口吻。`;

export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
