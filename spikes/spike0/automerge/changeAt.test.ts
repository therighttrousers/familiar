// Spike 0: applying the runtime agent's JSON Patch at the heads it last saw.
// The user edits concurrently; the agent's patch must land on what the agent meant.

import * as A from "@automerge/automerge";
import { Repo } from "@automerge/automerge-repo";
import { describe, expect, test } from "vitest";
import { applyJsonPatch } from "./jsonpatch";
import type { Operation } from "fast-json-patch";

/** User edits after the agent saw `initial`; the agent's ops are applied at the old heads. */
function race<T>(initial: T, user: A.ChangeFn<T>, agent: Operation[]) {
  const seen = A.from(initial as any) as A.Doc<T>;
  const seenHeads = A.getHeads(seen);
  const current = A.change(seen, user);

  // The PoC fallback: apply to the current doc. (Clone first: changeAt below outdates `current`.)
  let atCurrent: unknown;
  try {
    atCurrent = A.toJS(A.change(A.clone(current), (d) => applyJsonPatch(d, agent)));
  } catch (e) {
    atCurrent = `error: ${(e as Error).message}`;
  }

  const atOldHeads = A.changeAt(current, seenHeads, (d) => applyJsonPatch(d, agent)).newDoc;
  return { atOldHeads: A.toJS(atOldHeads), atCurrent };
}

describe("A.changeAt with JSON Patch", () => {
  test("replace by index after the user inserted before it", () => {
    const r = race<any>({ xs: ["a", "b", "c"] }, (d) => d.xs.unshift("x"), [
      { op: "replace", path: "/xs/1", value: "B" },
    ]);
    expect(r.atOldHeads).toEqual({ xs: ["x", "a", "B", "c"] });
    expect(r.atCurrent).toEqual({ xs: ["x", "B", "b", "c"] }); // the fallback hits the wrong item
  });

  test("remove by index after the user inserted before it", () => {
    const r = race<any>({ xs: ["a", "b", "c"] }, (d) => d.xs.unshift("x"), [{ op: "remove", path: "/xs/0" }]);
    expect(r.atOldHeads).toEqual({ xs: ["x", "b", "c"] });
  });

  test("insert after the user deleted before it", () => {
    const r = race<any>({ xs: ["a", "b", "c"] }, (d) => d.xs.splice(0, 1), [
      { op: "add", path: "/xs/2", value: "new" },
    ]);
    expect(r.atOldHeads).toEqual({ xs: ["b", "new", "c"] });
  });

  test("replace a field of an object the user moved by deleting an earlier item", () => {
    const r = race<any>(
      { rows: [{ n: 1 }, { n: 2 }] },
      (d) => d.rows.splice(0, 1),
      [{ op: "replace", path: "/rows/1/n", value: 20 }],
    );
    expect(r.atOldHeads).toEqual({ rows: [{ n: 20 }] });
    expect(r.atCurrent).toMatch(/error/); // the fallback rejects the path
  });

  test("patch touches an item the user deleted", () => {
    const r = race<any>(
      { rows: [{ n: 1 }, { n: 2 }] },
      (d) => d.rows.splice(1, 1),
      [{ op: "replace", path: "/rows/1/n", value: 20 }],
    );
    expect(r.atOldHeads).toEqual({ rows: [{ n: 1 }] }); // the edit is silently lost
  });

  test("whole-string replace merges with concurrent typing (via updateText)", () => {
    const r = race<any>(
      { en: "The cat", es: "El gato" },
      (d) => A.splice(d, ["es"], 7, 0, " negro"),
      [{ op: "replace", path: "/es", value: "El gatito" }],
    );
    // The agent's edit (gato → gatito) and the user's typing (+ " negro") both survive.
    expect(r.atOldHeads).toEqual({ en: "The cat", es: "El gatito negro" });
  });

  test("whole-string assignment (no updateText) loses concurrent typing", () => {
    const seen = A.from<any>({ es: "El gato" });
    const h = A.getHeads(seen);
    const current = A.change(seen, (d) => A.splice(d, ["es"], 7, 0, " negro"));
    const merged = A.changeAt(current, h, (d) => {
      d.es = "El gatito";
    }).newDoc;
    // A new string object wins the register; the user's splice went into the old one.
    expect(A.toJS(merged)).toEqual({ es: "El gatito" });
  });

  test("DocHandle.changeAt exists and works", async () => {
    const repo = new Repo();
    const h = repo.create<any>({ xs: ["a", "b"] });
    const heads = h.heads();
    h.change((d) => d.xs.unshift("x"));
    const newHeads = h.changeAt(heads, (d) => applyJsonPatch(d, [{ op: "replace", path: "/xs/1", value: "B" }]));
    expect(newHeads).toBeDefined();
    expect(A.toJS(h.doc())).toEqual({ xs: ["x", "a", "B"] });
    await repo.shutdown();
  });
});
