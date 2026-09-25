// Spike 0: Automerge patch → JSON Patch conversion.
// Automerge has no built-in converter, so we check a small hand-written one:
// applying the converted ops to the "before" JSON must give the "after" JSON.

import * as A from "@automerge/automerge";
import jsonpatch from "fast-json-patch";
import { describe, expect, test } from "vitest";
import { toJsonPatch } from "./jsonpatch";

function roundTrip<T>(initial: T, fn: A.ChangeFn<T>) {
  const before = A.from(initial as any) as A.Doc<T>;
  const after = A.change(before, fn);
  const patches = A.diff(after, A.getHeads(before), A.getHeads(after));
  const ops = toJsonPatch(A.toJS(before), patches);
  const applied = jsonpatch.applyPatch(structuredClone(A.toJS(before)), ops, true, false).newDocument;
  return { patches, ops, applied, expected: A.toJS(after) };
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

  test("patches from a DocHandle change event match A.diff", async () => {
    const { Repo } = await import("@automerge/automerge-repo");
    const repo = new Repo();
    const h = repo.create<any>({ xs: [1, 2, 3], text: "abc" });
    const before = A.toJS(h.doc());
    const seen: A.Patch[] = [];
    h.on("change", ({ patches }) => seen.push(...patches));
    h.change((d) => {
      d.xs.splice(0, 1);
      A.splice(d, ["text"], 1, 1, "XYZ");
    });
    const ops = toJsonPatch(before, seen);
    expect(jsonpatch.applyPatch(before, ops, true, false).newDocument).toEqual(A.toJS(h.doc()));
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

    let splices = 0;

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
        else if (r === 1) delete d[keys[rand(keys.length)]];
        else recurse(d, keys[rand(keys.length)], path, depth);
      }
    }
    function recurse(d: any, key: A.Prop, path: A.Prop[], depth: number) {
      const v = d[key];
      if (typeof v === "string") {
        const at = rand(v.length + 1);
        A.splice(root, [...path, key], at, rand(v.length - at + 1), words[rand(words.length)]);
        splices++;
      } else if (v !== null && typeof v === "object") mutate(v, [...path, key], depth + 1);
      else d[key] = randomValue(depth);
    }
    function randomValue(depth: number): any {
      const r = rand(depth > 2 ? 3 : 5);
      if (r === 0) return rand(100);
      if (r === 1) return words[rand(words.length)];
      if (r === 2) return rand(2) === 0 ? null : true;
      if (r === 3) return [randomValue(depth + 1), randomValue(depth + 1)];
      return { a: randomValue(depth + 1) };
    }

    let root: any;
    let doc = A.from<any>({ list: ["abc", { t: "text" }], m: { s: "hello" } });
    for (let i = 0; i < 1000; i++) {
      const before = doc;
      doc = A.change(doc, (d) => {
        root = d;
        for (let j = 0; j < 1 + rand(4); j++) mutate(d, [], 0);
      });
      const patches = A.diff(doc, A.getHeads(before), A.getHeads(doc));
      const ops = toJsonPatch(A.toJS(before), patches);
      const applied = jsonpatch.applyPatch(structuredClone(A.toJS(before)), ops, true, false).newDocument;
      expect(applied, `iteration ${i}`).toEqual(A.toJS(doc));
    }
    expect(splices).toBeGreaterThan(100);
  });
});
