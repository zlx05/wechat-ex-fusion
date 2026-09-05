/**
 * 工具噪音过滤器
 *
 * 某些 LLM 供应商（如 Z.ai 等聚合代理）会把服务端内置工具的输入/输出（JSON 参数、
 * URL、识别结果等）以文本形式塞进 `text_delta` 流。bridge 无法在协议层区分这些
 * 内容与 Claude 的正常旁白，于是会被原样推到微信，造成"全是代码"的灾难体验。
 *
 * 本模块用结构特征判定（不依赖任何 provider 签名），把命中段剥到只剩 Claude 的
 * 旁白，前面加上中性占位 `🔧 [工具调用]`。
 *
 * 设计文档：docs/superpowers/specs/2026-06-27-tool-noise-filter-design.md
 */

const FENCED_JSON = /```json\b[\s\S]*?```/i;
const URL_OR_PATH = /(https?:\/\/\S+)|(\/(?:Users|home|tmp|var|opt|etc)\/\S+)|(~\/\S+)/;

const LENGTH_THRESHOLD = 400;

function isStructuralLine(line: string): boolean {
  if (!line.trim()) return true;                   // 段落分隔
  if (/^\s*```/.test(line)) return true;           // 代码围栏
  if (/^\s*\*+/.test(line)) return true;           // **粗体** / *斜体* 头
  if (/^\s*[\[\]\{\}]/.test(line)) return true;    // JSON 括号
  if (/\\n/.test(line)) return true;               // JSON 字符串里的换行转义
  if (/^\s*"\w+"\s*:/.test(line)) return true;     // "key": value 行
  if (/^\s*\*\s/.test(line)) return true;          // markdown 斜体列表项
  return false;
}

/** 找出文本结尾处那段"Claude 的旁白"，没有则返回空串。 */
function extractTail(text: string): string {
  const lines = text.split('\n');
  let lastStructuralIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isStructuralLine(lines[i])) lastStructuralIdx = i;
  }
  if (lastStructuralIdx < 0 || lastStructuralIdx === lines.length - 1) return '';
  return lines.slice(lastStructuralIdx + 1).join('\n').trim();
}

/**
 * 三条件 AND 判定：长度 > 阈值 + 含 ```json``` 围栏 + 含 URL 或绝对路径。
 * 任一不满足即原样返回。
 */
export function filterToolNoise(text: string): string {
  if (text.length <= LENGTH_THRESHOLD) return text;
  if (!FENCED_JSON.test(text)) return text;
  if (!URL_OR_PATH.test(text)) return text;

  const tail = extractTail(text);
  return tail ? `🔧 [工具调用] — ${tail}` : '🔧 [工具调用]';
}
