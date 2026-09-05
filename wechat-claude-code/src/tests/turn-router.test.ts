import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnRouter, type RoutedMessage } from '../claude/turn-router.js';

function newRouter() {
  const emitted: RoutedMessage[] = [];
  const router = new TurnRouter((m) => emitted.push(m));
  return { router, emitted };
}

test('onText 累积不立即 emit', () => {
  const { router, emitted } = newRouter();
  router.onText('hello ');
  router.onText('world');
  assert.deepEqual(emitted, []);
});

test('onTurnEnd(tool_use) 把 turnBuffer 作为 interstitial emit', () => {
  const { router, emitted } = newRouter();
  router.onText('让我看一下');
  router.onTurnEnd('tool_use');
  assert.deepEqual(emitted, [{ text: '让我看一下', role: 'interstitial' }]);
});

test('onTurnEnd(end_turn) 不立即 emit，攒到 drain', () => {
  const { router, emitted } = newRouter();
  router.onText('最终答案第一段');
  router.onTurnEnd('end_turn');
  assert.deepEqual(emitted, []);
  router.drain();
  assert.deepEqual(emitted, [{ text: '最终答案第一段', role: 'final' }]);
});

test('多个 end_turn 回合用 \\n\\n 连接成一个 final', () => {
  const { router, emitted } = newRouter();
  router.onText('段一');
  router.onTurnEnd('pause_turn');
  router.onText('段二');
  router.onTurnEnd('end_turn');
  router.drain();
  assert.deepEqual(emitted, [{ text: '段一\n\n段二', role: 'final' }]);
});

test('tool_use 和 end_turn 混合：interstitial 立即发，final 攒到 drain', () => {
  const { router, emitted } = newRouter();
  router.onText('让我查一下');
  router.onTurnEnd('tool_use');          // → interstitial 立即
  router.onText('找到了。');
  router.onText('详细说明...');
  router.onTurnEnd('end_turn');          // → final 攒着
  router.drain();                         // → final 发出
  assert.deepEqual(emitted, [
    { text: '让我查一下', role: 'interstitial' },
    { text: '找到了。详细说明...', role: 'final' },
  ]);
});

test('空文本回合不产生空消息', () => {
  const { router, emitted } = newRouter();
  router.onTurnEnd('tool_use');           // turnBuffer 空
  router.onTurnEnd('end_turn');           // turnBuffer 空
  router.drain();
  assert.deepEqual(emitted, []);
});

test('onTurnEnd 未触发时 drain 也能把残留 turnBuffer 当 interstitial 发出', () => {
  const { router, emitted } = newRouter();
  router.onText('未结束的残留');
  router.drain();
  assert.deepEqual(emitted, [
    { text: '未结束的残留', role: 'interstitial' },
  ]);
});

test('纯文本 Q&A（无 tool_use，单 end_turn）整段作为 final', () => {
  const { router, emitted } = newRouter();
  const chunks = ['闭包是...', '举个例子...', '总结...'];
  for (const c of chunks) router.onText(c);
  router.onTurnEnd('end_turn');
  router.drain();
  assert.deepEqual(emitted, [
    { text: chunks.join(''), role: 'final' },
  ]);
});
