import { applyConversationRuntimeEvents, createConversationRuntime, type ConversationRuntime } from './conversationRuntime';
import type { ConversationEvent, ConversationReplay } from './v2';

type Replay = (conversationId: string, afterSequence: number, limit: number) => Promise<ConversationReplay>;
type Update = (state: ConversationRuntime, applied: ConversationEvent[], recovering: boolean) => void;

/** One projection is shared by REST pages and live frames. A late history
 * response can fill a gap, but can never replace newer applied state. */
export class ConversationRecovery {
  private readonly states = new Map<string, ConversationRuntime>();
  private readonly recovering = new Map<string, Promise<void>>();
  private readonly incomplete = new Set<string>();
  private epoch = 0;

  constructor(private readonly replay: Replay, private readonly update: Update, private readonly onError: (message: string) => void) {}

  get(conversationId: string): ConversationRuntime | undefined { return this.states.get(conversationId); }
  isRecovering(conversationId: string): boolean { return this.recovering.has(conversationId) || this.incomplete.has(conversationId); }

  reset(): void {
    this.epoch++;
    this.states.clear();
    this.incomplete.clear();
    this.recovering.clear();
  }

  receive(conversationId: string, workspaceId: string, events: readonly ConversationEvent[]): void {
    const previous = this.states.get(conversationId) ?? createConversationRuntime(conversationId, workspaceId);
    const result = applyConversationRuntimeEvents(previous, events);
    if (result.state === previous && this.states.has(conversationId)) return;
    this.states.set(conversationId, result.state);
    this.update(result.state, result.appliedEvents, this.isRecovering(conversationId) || result.missingSequences.length > 0);
    if (result.missingSequences.length && !this.recovering.has(conversationId)) {
      void this.recover(conversationId, workspaceId);
    }
  }

  recover(conversationId: string, workspaceId: string): Promise<void> {
    const existing = this.recovering.get(conversationId);
    if (existing) return existing;
    const epoch = this.epoch;
    // Defer work until the single-flight entry exists, including synchronous
    // replay mocks. This also suppresses stale approval prompts during replay.
    const work = Promise.resolve().then(async () => {
      let cursor = this.states.get(conversationId)?.appliedSequence ?? 0;
      let pages = 0;
      for (;;) {
        const page = await this.replay(conversationId, cursor, 500);
        if (epoch !== this.epoch) return;
        this.receive(conversationId, workspaceId, page.events);
        const state = this.states.get(conversationId)!;
        const next = state.appliedSequence;
        const missing = next < state.highWaterSequence;
        if (!page.hasMore && !missing) {
          this.incomplete.delete(conversationId);
          return;
        }
        if (next <= cursor || ++pages >= 10_000) {
          throw new Error('对话记录存在缺口，恢复未完成。请重新连接后核对记录。');
        }
        cursor = next;
      }
    }).catch((error: unknown) => {
      if (epoch === this.epoch) {
        this.incomplete.add(conversationId);
        this.onError(error instanceof Error ? error.message : '对话恢复失败');
      }
    }).finally(() => {
      if (epoch !== this.epoch) return;
      this.recovering.delete(conversationId);
      const state = this.states.get(conversationId);
      if (state) this.update(state, [], this.isRecovering(conversationId));
    });
    this.recovering.set(conversationId, work);
    const state = this.states.get(conversationId);
    if (state) this.update(state, [], true);
    return work;
  }
}
