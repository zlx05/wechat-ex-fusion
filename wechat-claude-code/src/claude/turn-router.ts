/**
 * TurnRouter 把 Claude CLI 的流式输出按"回合"分流：
 *
 * - tool_use 回合的文本 → 立即作为 interstitial emit（agent loop 进度）
 * - 其他 stop_reason（end_turn / max_tokens / stop_sequence / pause_turn / ...）
 *   的文本 → 攒到 pendingFinal，drain 时一次性作为 final emit
 *
 * 设计参考 docs/superpowers/specs/2026-06-20-message-batching-design.md。
 *
 * 本类不做任何 I/O，只决定"何时把哪段文本以什么 role emit"。
 * 调用方（main.ts）负责把 RoutedMessage 切分（splitMessage）并发到微信。
 */

export type MessageRole = 'interstitial' | 'final';

export interface RoutedMessage {
  text: string;
  role: MessageRole;
}

export class TurnRouter {
  private turnBuffer = '';
  private pendingFinal = '';

  constructor(private readonly emit: (msg: RoutedMessage) => void) {}

  onText(delta: string): void {
    this.turnBuffer += delta;
  }

  onTurnEnd(stopReason: string): void {
    const text = this.turnBuffer;
    this.turnBuffer = '';
    if (!text.trim()) return;
    if (stopReason === 'tool_use') {
      this.emit({ text, role: 'interstitial' });
    } else {
      // end_turn / max_tokens / stop_sequence / pause_turn / 未知值
      // 一律当最终答案处理（宁可合并也不丢）
      this.pendingFinal += this.pendingFinal ? '\n\n' + text : text;
    }
  }

  /** 流结束时调用。先发 final，再 drain 残留 interstitial。 */
  drain(): void {
    if (this.pendingFinal.trim()) {
      this.emit({ text: this.pendingFinal, role: 'final' });
      this.pendingFinal = '';
    }
    if (this.turnBuffer.trim()) {
      this.emit({ text: this.turnBuffer, role: 'interstitial' });
      this.turnBuffer = '';
    }
  }
}
