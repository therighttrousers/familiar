// @harness/state: the applet's store (see docs/designs/state.md#in-applet-store-api).
// A thin wrapper over the state doc's automerge-repo handle. A convenience, not a
// security boundary: the parent grants the iframe only this doc.

import type { DocHandle } from "@automerge/automerge-repo";
import { useSyncExternalStore } from "react";

export { updateText } from "@automerge/automerge-repo";

let handle: DocHandle<unknown> | undefined;
const listeners = new Set<() => void>();

/** Called by the loader before it renders the applet. */
export function connectStore(h: DocHandle<unknown>): void {
  handle = h;
  h.on("change", () => {
    for (const l of listeners) l();
  });
}

function connected(): DocHandle<unknown> {
  if (!handle) throw new Error("@harness/state: the store isn't connected yet");
  return handle;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => connected().doc();

export const store = {
  /** React hook returning the current state. */
  use<S>(): S {
    // biome-ignore lint/correctness/useHookAtTopLevel: store.use is itself a hook (the design names it use)
    return useSyncExternalStore(subscribe, snapshot) as S;
  },
  /**
   * Changes the state with an Automerge change function. To change a string that
   * someone else may edit at the same time, use `updateText(draft, path, value)`
   * rather than assigning it, so concurrent edits merge.
   */
  change<S>(fn: (draft: S) => void): void {
    connected().change(fn as (draft: unknown) => void);
  },
};
