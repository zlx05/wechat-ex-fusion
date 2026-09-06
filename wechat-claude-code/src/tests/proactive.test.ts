import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withinQuietWindow,
  untilAfterQuietWindow,
  randomProactiveDelayMs,
  DEFAULT_QUIET_END,
} from '../proactive.js';
import type { Config } from '../config.js';

const base: Config = { workingDirectory: '/tmp' };

function dateAt(hour: number, minute = 0): Date {
  return new Date(2026, 8, 6, hour, minute, 0, 0);
}

test('默认静默窗口 23:00–07:00：23 点入窗，7 点出窗', () => {
  assert.equal(withinQuietWindow(dateAt(22, 59), base), false);
  assert.equal(withinQuietWindow(dateAt(23, 0), base), true);
  assert.equal(withinQuietWindow(dateAt(3, 30), base), true);
  assert.equal(withinQuietWindow(dateAt(6, 59), base), true);
  assert.equal(withinQuietWindow(dateAt(7, 0), base), false);
});

test('非跨天窗口 start<end：1:00–6:00', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveQuietStart: 1, idleProactiveQuietEnd: 6 };
  assert.equal(withinQuietWindow(dateAt(0, 59), cfg), false);
  assert.equal(withinQuietWindow(dateAt(1, 0), cfg), true);
  assert.equal(withinQuietWindow(dateAt(5, 59), cfg), true);
  assert.equal(withinQuietWindow(dateAt(6, 0), cfg), false);
});

test('start==end 表示不静默', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveQuietStart: 23, idleProactiveQuietEnd: 23 };
  assert.equal(withinQuietWindow(dateAt(23, 30), cfg), false);
  assert.equal(withinQuietWindow(dateAt(3, 0), cfg), false);
});

test('深夜(1:30)中途触发 → 顺延到当天 07:00', () => {
  const now = dateAt(1, 30);
  const ms = untilAfterQuietWindow(base, now);
  const fire = new Date(now.getTime() + ms);
  assert.equal(fire.getHours(), DEFAULT_QUIET_END);
  assert.ok(fire.getTime() > now.getTime());
  assert.ok(ms > 0 && ms < 24 * 3_600_000);
});

test('白天(12:00) → 次日 07:00（已错过今天的窗口结束）', () => {
  const now = dateAt(12, 0);
  const ms = untilAfterQuietWindow(base, now);
  const fire = new Date(now.getTime() + ms);
  assert.equal(fire.getHours(), DEFAULT_QUIET_END);
  assert.ok(ms > 0 && ms < 24 * 3_600_000);
});

test('随机间隔落在 [min,max] 区间', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveMinHours: 2, idleProactiveMaxHours: 4 };
  for (let i = 0; i < 300; i++) {
    const ms = randomProactiveDelayMs(cfg);
    assert.ok(ms >= 2 * 3_600_000, `ms=${ms}`);
    assert.ok(ms < 4 * 3_600_000, `ms=${ms}`);
  }
});

test('min==max 时返回固定值', () => {
  const cfg: Config = { workingDirectory: '/tmp', idleProactiveMinHours: 5, idleProactiveMaxHours: 5 };
  for (let i = 0; i < 10; i++) {
    assert.equal(randomProactiveDelayMs(cfg), 5 * 3_600_000);
  }
});