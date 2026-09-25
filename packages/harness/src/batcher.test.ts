import type { JsonPatchOp } from "protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Batcher } from "./batcher.ts";

const replace = (path: string, value: string): JsonPatchOp => ({ op: "replace", path, value });

describe("Batcher", () => {
  let flushed: JsonPatchOp[][];
  let pending: boolean[];
  let batcher: Batcher;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    pending = [];
    batcher = new Batcher({
      idleMs: 1500,
      maxMs: 5000,
      onFlush: (p) => flushed.push(p),
      onPendingChange: (p) => pending.push(p),
    });
  });
  afterEach(() => {
    batcher.dispose();
    vi.useRealTimers();
  });

  test("flushes after 1.5 s idle", () => {
    batcher.add([replace("/english", "h")]);
    vi.advanceTimersByTime(1499);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([[replace("/english", "h")]]);
    expect(pending).toEqual([true, false]);
  });

  test("each change restarts the idle timer", () => {
    batcher.add([replace("/english", "h")]);
    vi.advanceTimersByTime(1000);
    batcher.add([replace("/english", "hi")]);
    vi.advanceTimersByTime(1000);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(flushed).toHaveLength(1);
  });

  test("flushes 5 s after the first unsent change, even while changes keep coming", () => {
    for (let t = 0; t < 5000; t += 500) {
      batcher.add([replace("/english", `t${t}`)]);
      vi.advanceTimersByTime(500);
    }
    expect(flushed).toEqual([[replace("/english", "t4500")]]);
  });

  test("keeps only the last of consecutive whole-string replaces of the same string", () => {
    batcher.add([replace("/english", "h")]);
    batcher.add([replace("/english", "he")]);
    batcher.add([replace("/spanish", "x")]);
    batcher.add([replace("/english", "hel")]);
    batcher.add([replace("/english", "hell")]);
    batcher.flush();
    expect(flushed).toEqual([[replace("/english", "he"), replace("/spanish", "x"), replace("/english", "hell")]]);
  });

  test("a manual flush with nothing pending does nothing", () => {
    batcher.flush();
    vi.advanceTimersByTime(10_000);
    expect(flushed).toEqual([]);
    expect(pending).toEqual([]);
  });
});
