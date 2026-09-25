// biome-ignore-all lint/suspicious/noExplicitAny: tests mutate drafts of arbitrary shape
// Automerge patch <-> JSON Patch conversion. Ported from Spike 0, with applyJsonPatch
// as the oracle: applying the converted ops to "before" must give "after".

import * as A from "@automerge/automerge";
import { Repo } from "@automerge/automerge-repo";
import type { Json, JsonPatchOp } from "protocol";
import { describe, expect, test } from "vitest";
import { applyJsonPatch, parseJsonPatch, toJsonPatch } from "./jsonpatch.ts";

function apply(before: unknown, ops: JsonPatchOp[]): unknown {
  return A.toJS(A.change(A.from(structuredClone(before) as any), (d) => applyJsonPatch(d, ops)));
}

function roundTrip<T>(initial: T, fn: A.ChangeFn<T>) {
  const before = A.from(initial as any) as A.Doc<T>;
  const after = A.change(before, fn);
  const patches = A.diff(after, A.getHeads(before), A.getHeads(after));
  const ops = toJsonPatch(A.toJS(before), patches);
  return { ops, applied: apply(A.toJS(before), ops), expected: A.toJS(after) };
}

describe("toJsonPatch", () => {
  test("map put and delete", () => {
    const r = roundTrip<any>({ a: 1, b: 2 }, (d) => {
      d.a = 10;
      delete d.b;
      d.c = { nested: [1, 2] };
    });
    expect(r.applied).toEqual(r.expected);
  });

  test("list insert, delete, replace", () => {
    const r = roundTrip<any>({ xs: ["a", "b", "c", "d"] }, (d) => {
      d.xs.splice(1, 2, "X", "Y", "Z");
      d.xs[0] = "A";
      d.xs.push({ k: "v" });
    });
    expect(r.applied).toEqual(r.expected);
  });

  test("text edits become one whole-string replace", () => {
    const r = roundTrip<any>({ text: "hello world" }, (d) => {
      A.splice(d, ["text"], 5, 0, ",");
      A.splice(d, ["text"], 0, 1, "H");
    });
    expect(r.applied).toEqual(r.expected);
    expect(r.ops).toEqual([{ op: "replace", path: "/text", value: "Hello, world" }]);
  });

  test("keys needing escaping", () => {
    const r = roundTrip<any>({ "a/b": 1, "c~d": 2 }, (d) => {
      d["a/b"] = 3;
      delete d["c~d"];
    });
    expect(r.applied).toEqual(r.expected);
  });

  test("patches from a DocHandle change event", async () => {
    const repo = new Repo();
    const h = repo.create<any>({ xs: [1, 2, 3], text: "abc" });
    const before = A.toJS(h.doc());
    let ops: JsonPatchOp[] = [];
    h.on("change", ({ patches, patchInfo }) => {
      ops = toJsonPatch(patchInfo.before, patches);
    });
    h.change((d) => {
      d.xs.splice(0, 1);
      A.splice(d, ["text"], 1, 1, "XYZ");
    });
    expect(apply(before, ops)).toEqual(A.toJS(h.doc()));
    await repo.shutdown();
  });

  test("randomized round trips", () => {
    let seed = 1;
    // mulberry32
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    const words = ["", "a", "bc", "hello", "x/y", "~"];
    const word = () => words[rand(words.length)] as string;
    let splices = 0;
    let root: any;

    function mutate(d: any, path: A.Prop[], depth: number) {
      if (Array.isArray(d)) {
        const r = rand(4);
        if (r === 0 || d.length === 0) d.splice(rand(d.length + 1), 0, randomValue(depth));
        else if (r === 1) d.splice(rand(d.length), 1 + rand(2));
        else if (r === 2) d[rand(d.length)] = randomValue(depth);
        else recurse(d, rand(d.length), path, depth);
      } else {
        const keys = Object.keys(d);
        const r = rand(4);
        if (r === 0 || keys.length === 0) d[`k${rand(5)}`] = randomValue(depth);
        else if (r === 1) delete d[keys[rand(keys.length)] as string];
        else recurse(d, keys[rand(keys.length)] as string, path, depth);
      }
    }
    function recurse(d: any, key: A.Prop, path: A.Prop[], depth: number) {
      const v = d[key];
      if (typeof v === "string") {
        const at = rand(v.length + 1);
        A.splice(root, [...path, key], at, rand(v.length - at + 1), word());
        splices++;
      } else if (v !== null && typeof v === "object") mutate(v, [...path, key], depth + 1);
      else d[key] = randomValue(depth);
    }
    function randomValue(depth: number): any {
      const r = rand(depth > 2 ? 3 : 5);
      if (r === 0) return rand(100);
      if (r === 1) return word();
      if (r === 2) return rand(2) === 0 ? null : true;
      if (r === 3) return [randomValue(depth + 1), randomValue(depth + 1)];
      return { a: randomValue(depth + 1) };
    }

    let doc = A.from<any>({ list: ["abc", { t: "text" }], m: { s: "hello" } });
    for (let i = 0; i < 1000; i++) {
      const before = doc;
      doc = A.change(doc, (d) => {
        root = d;
        for (let j = 0; j < 1 + rand(4); j++) mutate(d, [], 0);
      });
      const patches = A.diff(doc, A.getHeads(before), A.getHeads(doc));
      const ops = toJsonPatch(A.toJS(before), patches);
      expect(apply(A.toJS(before), ops), `iteration ${i}`).toEqual(A.toJS(doc));
    }
    expect(splices).toBeGreaterThan(100);
  });
});

describe("applyJsonPatch", () => {
  test("a string replace merges with a concurrent edit to the same string", () => {
    const base = A.from<any>({ text: "hello world" });
    const user = A.change(A.clone(base), (d) => A.splice(d, ["text"], 0, 1, "H"));
    const agent = A.change(A.clone(base), (d) =>
      applyJsonPatch(d, [{ op: "replace", path: "/text", value: "hello world!" }]),
    );
    expect(A.merge(user, agent).text).toBe("Hello world!");
  });

  test("a path that doesn't resolve throws, and the change is discarded", () => {
    const doc = A.from<any>({ a: { b: 1 } });
    expect(() =>
      A.change(doc, (d) =>
        applyJsonPatch(d, [
          { op: "replace", path: "/a/b", value: 2 },
          { op: "replace", path: "/x/y", value: 1 },
        ]),
      ),
    ).toThrow(/does not resolve/);
    expect(A.toJS(doc)).toEqual({ a: { b: 1 } });
  });

  test("replace and remove need an existing key; add doesn't", () => {
    const doc = A.from<any>({ a: 1 });
    expect(() => A.change(doc, (d) => applyJsonPatch(d, [{ op: "replace", path: "/b", value: 1 }]))).toThrow();
    expect(() => A.change(doc, (d) => applyJsonPatch(d, [{ op: "remove", path: "/b" }]))).toThrow();
    expect(A.toJS(A.change(doc, (d) => applyJsonPatch(d, [{ op: "add", path: "/b", value: 2 }])))).toEqual({
      a: 1,
      b: 2,
    });
  });

  test("array indices, including - for appending", () => {
    const doc = A.from<any>({ xs: [1, 2] });
    const ops: JsonPatchOp[] = [
      { op: "add", path: "/xs/-", value: 3 },
      { op: "add", path: "/xs/0", value: 0 },
      { op: "remove", path: "/xs/1" },
    ];
    expect(A.toJS(A.change(doc, (d) => applyJsonPatch(d, ops)))).toEqual({ xs: [0, 2, 3] });
    expect(() =>
      A.change(A.from<any>({ xs: [1, 2] }), (d) => applyJsonPatch(d, [{ op: "replace", path: "/xs/2", value: 1 }])),
    ).toThrow(/Bad index/);
  });
});

describe("parseJsonPatch", () => {
  test("accepts add, replace and remove", () => {
    const ops: Json = [
      { op: "add", path: "/a", value: 1 },
      { op: "replace", path: "/b", value: null },
      { op: "remove", path: "/c" },
    ];
    expect(parseJsonPatch(ops)).toEqual(ops);
  });

  test.each([
    ["not an array", { op: "add", path: "/a", value: 1 }],
    ["unsupported op", [{ op: "move", from: "/a", path: "/b" }]],
    ["missing value", [{ op: "replace", path: "/a" }]],
    ["root path", [{ op: "replace", path: "", value: {} }]],
    ["relative path", [{ op: "replace", path: "a", value: 1 }]],
  ])("rejects %s", (_, input) => {
    expect(() => parseJsonPatch(input)).toThrow();
  });
});
