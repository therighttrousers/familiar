// Holds user changes until the user pauses, then flushes them as one batch
// (see docs/designs/runtime-agent.md#batching).

import type { JsonPatchOp } from "protocol";
import { supersedes } from "./jsonpatch.ts";

export type BatcherOptions = {
  /** Flush after this long without a new change. */
  idleMs: number;
  /** Flush at most this long after the first unsent change. */
  maxMs: number;
  onFlush: (patch: JsonPatchOp[]) => void;
  /** Called when the batcher starts or stops holding changes. */
  onPendingChange?: (pending: boolean) => void;
};

export class Batcher {
  #pending: JsonPatchOp[] = [];
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #maxTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #opts: BatcherOptions;

  constructor(opts: BatcherOptions) {
    this.#opts = opts;
  }

  get pending(): boolean {
    return this.#pending.length > 0;
  }

  add(ops: JsonPatchOp[]): void {
    if (ops.length === 0) return;
    const wasPending = this.pending;
    for (const op of ops) {
      // Typing produces one whole-string replace per keystroke; keep only the last.
      if (supersedes(op, this.#pending[this.#pending.length - 1])) this.#pending.pop();
      this.#pending.push(op);
    }
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.flush(), this.#opts.idleMs);
    if (!wasPending) {
      this.#maxTimer = setTimeout(() => this.flush(), this.#opts.maxMs);
      this.#opts.onPendingChange?.(true);
    }
  }

  flush(): void {
    clearTimeout(this.#idleTimer);
    clearTimeout(this.#maxTimer);
    if (!this.pending) return;
    const patch = this.#pending;
    this.#pending = [];
    this.#opts.onFlush(patch);
    this.#opts.onPendingChange?.(false);
  }

  dispose(): void {
    clearTimeout(this.#idleTimer);
    clearTimeout(this.#maxTimer);
  }
}
