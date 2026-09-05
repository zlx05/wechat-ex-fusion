import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterToolNoise } from '../claude/tool-noise-filter.js';

// 测试跑在 dist/tests/，但 fixture JSON 不会被 tsc 复制——直接从 src/ 读。
const fixturePath = join(process.cwd(), 'src', 'tests', 'fixtures', 'tool-noise', 'real-cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: Array<{
    name: string;
    input: string;
    expectedFilter: boolean;
    expectedTail: string | null;
  }>;
};

test('real-cases.json 7 条命中样本应被压缩到 🔧 前缀', () => {
  const hits = fixture.cases.filter((c) => c.expectedFilter);
  assert.equal(hits.length, 7, '今日 log 应该恰好命中 7 条');
  for (const c of hits) {
    const got = filterToolNoise(c.input);
    assert.ok(got.startsWith('🔧 [工具调用]'), `${c.name}: 缺少 🔧 前缀 → ${got.slice(0, 80)}`);
    assert.ok(got.length < c.input.length / 2, `${c.name}: 压缩率不够 (input=${c.input.length} got=${got.length})`);
    if (c.expectedTail) {
      assert.ok(got.includes(c.expectedTail), `${c.name}: 没有保留期望的尾巴 → ${c.expectedTail.slice(0, 60)}`);
    }
  }
});

test('real-cases.json 正常样本不应被改写', () => {
  const normals = fixture.cases.filter((c) => !c.expectedFilter);
  assert.ok(normals.length >= 5, '至少 5 条正常样本');
  for (const c of normals) {
    const got = filterToolNoise(c.input);
    assert.equal(got, c.input, `${c.name}: 正常消息被误改`);
  }
});

test('短消息直接放行', () => {
  assert.equal(filterToolNoise('OK, 看一下'), 'OK, 看一下');
  assert.equal(filterToolNoise(''), '');
});

test('有 URL 但无 ```json``` 围栏：不命中', () => {
  const text = [
    '我去翻了翻文档：',
    'https://example.com/docs/api',
    '',
    '```',
    'const x = fetch(url)',
    'const y = await x.json()',
    'const z = JSON.stringify(y)',
    'const w = JSON.parse(z)',
    'const v = JSON.stringify(w)',
    'const u = JSON.parse(v)',
    '```',
    '就是这么个写法。',
  ].join('\n');
  assert.equal(filterToolNoise(text), text);
});

test('有 ```json``` 围栏但无 URL：不命中', () => {
  const text = [
    '配置长这样：',
    '',
    '```json',
    '{"name": "demo", "version": "1.0.0", "main": "index.js", "license": "MIT"}',
    '```',
    '',
    '直接抄就行。',
  ].join('\n');
  assert.equal(filterToolNoise(text), text);
});

test('长度恰好 400：放行（边界 < 400）', () => {
  const text = 'a'.repeat(400);
  assert.equal(filterToolNoise(text), text);
});

test('命中但没有可提取尾巴：返回中性占位', () => {
  // 全是结构性行，没有 prose tail
  const text = [
    '```json',
    '{"imageSource":"https://example.com/a.png","prompt":"describe"}',
    '```',
    '**Output:**',
    '**result_summary:** [{"text": "hello world"}]',
  ].join('\n') + '\n';
  // bump length so it crosses the 400-char threshold
  const padded = text + ' '.repeat(420 - text.length);
  const got = filterToolNoise(padded);
  assert.equal(got, '🔧 [工具调用]');
});
