#!/usr/bin/env node
// One-shot script: pull the 7 tool-noise hits + 8 normal samples from today's
// log into a JSON fixture the test suite can consume. Re-run after future
// incidents to refresh fixtures.

import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.HOME + '/.wechat-claude-code/logs/bridge-2026-06-27.log';
const OUT = join(__dirname, 'real-cases.json');

const FENCED_JSON = /```json\b[\s\S]*?```/i;
const URL_OR_PATH = /(https?:\/\/\S+)|(\/(?:Users|home|tmp|var|opt|etc)\/\S+)|(~\/\S+)/;

function looksLikeToolDump(text) {
  if (text.length <= 400) return false;
  if (!FENCED_JSON.test(text)) return false;
  if (!URL_OR_PATH.test(text)) return false;
  return true;
}

function isStructuralLine(line) {
  if (!line.trim()) return true;
  if (/^\s*```/.test(line)) return true;
  if (/^\s*\*+/.test(line)) return true;
  if (/^\s*[\[\]\{\}]/.test(line)) return true;
  if (/\\n/.test(line)) return true;
  if (/^\s*"\w+"\s*:/.test(line)) return true;
  if (/^\s*\*\s/.test(line)) return true;
  return false;
}

function splitDumpAndTail(text) {
  const lines = text.split('\n');
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isStructuralLine(lines[i])) lastIdx = i;
  }
  if (lastIdx < 0 || lastIdx === lines.length - 1) return '';
  return lines.slice(lastIdx + 1).join('\n').trim();
}

function filterToolNoise(text) {
  if (!looksLikeToolDump(text)) return text;
  const tail = splitDumpAndTail(text);
  return tail ? `🔧 [工具调用] — ${tail}` : '🔧 [工具调用]';
}

const rl = createInterface({ input: createReadStream(LOG_PATH) });
const all = [];
rl.on('line', (line) => {
  if (!line.includes('/ilink/bot/sendmessage')) return;
  if (!line.includes('"type":1,')) return;
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) return;
  let payload;
  try { payload = JSON.parse(line.slice(jsonStart)); } catch { return; }
  const text = payload?.body?.msg?.item_list?.[0]?.text_item?.text;
  if (typeof text !== 'string') return;
  all.push({ ts: line.slice(0, 23), text });
});
await new Promise((r) => rl.on('close', r));

const hits = all.filter((p) => looksLikeToolDump(p.text));
// Normal sample: 8 diverse untouched messages
const normalPool = all.filter((p) => !looksLikeToolDump(p.text));
const normal = [];
for (const target of [
  /^✅/,                    // status lines
  /\n\n/,                  // multi-paragraph
  /```/,                   // has code block (but not json-fenced)
  /\/Users\//,             // has paths
  /\|.*\|.*\|/,            // has tables
  /已|完成|搞定|找到/,      // conclusion phrases
]) {
  const found = normalPool.find((p) => target.test(p.text) && !normal.includes(p));
  if (found) normal.push(found);
}
while (normal.length < 8 && normal.length < normalPool.length) {
  normal.push(normalPool[normal.length]);
}

const cases = hits.map((p, i) => ({
  name: `hit-${i + 1}`,
  input: p.text,
  expectedFilter: true,
  expectedTail: splitDumpAndTail(p.text),
})).concat(normal.slice(0, 8).map((p, i) => ({
  name: `normal-${i + 1}`,
  input: p.text,
  expectedFilter: false,
  expectedTail: null,
})));

mkdirSync(__dirname, { recursive: true });
writeFileSync(OUT, JSON.stringify({ cases }, null, 2));
console.log(`Extracted ${hits.length} hits + ${Math.min(8, normal.length)} normals → ${OUT}`);
