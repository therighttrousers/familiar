// Conversions between Automerge patches and JSON Patch (RFC 6902).
//
// toJsonPatch: Automerge patches (from A.diff or a handle's change event) → JSON Patch,
// for showing user changes to the runtime agent.
//
// applyJsonPatch: JSON Patch → mutations on an Automerge change-function draft,
// for applying the runtime agent's patch_state calls.

import * as A from "@automerge/automerge";
import type { Operation } from "fast-json-patch";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const escape = (seg: A.Prop) => String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
const pointer = (path: A.Prop[]) => path.map((s) => `/${escape(s)}`).join("");

function get(root: Json, path: A.Prop[]): Json {
  let cur: any = root;
  for (const seg of path) cur = cur[seg];
  return cur;
}

function clone(v: unknown): Json {
  return v === undefined ? null : structuredClone(v as Json);
}

// Applies a JSON Patch op to a plain JSON value, in place. Only used to track the
// intermediate state while converting, so it supports only the ops we emit.
function applyToJson(root: Json, op: Operation): void {
  const segs = op.path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const key = segs.pop()!;
  const parent: any = get(root, segs);
  if (Array.isArray(parent)) {
    const i = Number(key);
    if (op.op === "add") parent.splice(i, 0, clone((op as any).value));
    else if (op.op === "remove") parent.splice(i, 1);
    else if (op.op === "replace") parent[i] = clone((op as any).value);
  } else {
    if (op.op === "remove") delete parent[key];
    else parent[key] = clone((op as any).value);
  }
}

/**
 * Converts Automerge patches to JSON Patch. `before` is the JSON state the patches
 * apply to. Text edits (splices and deletes inside a string) become whole-string
 * `replace` ops, since JSON Patch has no string splice. Marks and conflicts are dropped.
 */
export function toJsonPatch(before: unknown, patches: A.Patch[]): Operation[] {
  const state = { root: clone(before) } as { root: Json };
  const ops: Operation[] = [];
  const emit = (op: Operation) => {
    // Collapse consecutive whole-string replaces of the same string.
    const last = ops[ops.length - 1];
    if (op.op === "replace" && last?.op === "replace" && last.path === op.path && typeof op.value === "string") {
      ops.pop();
    }
    ops.push(op);
    applyToJson(state as unknown as Json, { ...op, path: `/root${op.path}` } as Operation);
  };

  for (const p of patches) {
    const parentPath = p.path.slice(0, -1);
    const key = p.path[p.path.length - 1];
    const parent = get(state.root, parentPath);
    switch (p.action) {
      case "put":
        emit(
          Array.isArray(parent)
            ? { op: "replace", path: pointer(p.path), value: clone(p.value) }
            : { op: "add", path: pointer(p.path), value: clone(p.value) },
        );
        break;
      case "insert":
        p.values.forEach((v, j) =>
          emit({ op: "add", path: pointer([...parentPath, (key as number) + j]), value: clone(v) }),
        );
        break;
      case "del":
        if (typeof parent === "string") {
          const i = key as number;
          const text = parent.slice(0, i) + parent.slice(i + (p.length ?? 1));
          emit({ op: "replace", path: pointer(parentPath), value: text });
        } else if (Array.isArray(parent)) {
          for (let j = 0; j < (p.length ?? 1); j++) emit({ op: "remove", path: pointer(p.path) });
        } else {
          emit({ op: "remove", path: pointer(p.path) });
        }
        break;
      case "splice": {
        const s = parent as unknown as string;
        const i = key as number;
        emit({ op: "replace", path: pointer(parentPath), value: s.slice(0, i) + p.value + s.slice(i) });
        break;
      }
      case "inc":
        emit({ op: "replace", path: pointer(p.path), value: (get(state.root, p.path) as number) + p.value });
        break;
      case "mark":
      case "unmark":
      case "conflict":
        break;
    }
  }
  return ops;
}

/**
 * Applies JSON Patch ops to an Automerge draft inside a change function.
 * Whole-string replaces go through A.updateText, so they merge with concurrent
 * character-level edits instead of overwriting them. Throws on paths that don't resolve.
 */
export function applyJsonPatch(draft: any, ops: Operation[]): void {
  for (const op of ops) {
    const segs = op.path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    const key = segs.pop()!;
    let parent = draft;
    const path: A.Prop[] = [];
    for (const s of segs) {
      const seg = Array.isArray(parent) ? Number(s) : s;
      parent = parent[seg];
      path.push(seg);
      if (parent === undefined || parent === null || typeof parent !== "object") {
        throw new Error(`Path does not resolve: ${op.path}`);
      }
    }
    const value = (op as any).value;
    if (Array.isArray(parent)) {
      const i = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new Error(`Bad index: ${op.path}`);
      if (op.op === "add") parent.splice(i, 0, value);
      else if (op.op === "remove") parent.splice(i, 1);
      else if (op.op === "replace") setValue(parent, i, value, [...path, i]);
      else throw new Error(`Unsupported op: ${op.op}`);
    } else {
      if (op.op === "remove") {
        if (!(key in parent)) throw new Error(`Path does not resolve: ${op.path}`);
        delete parent[key];
      } else if (op.op === "add" || op.op === "replace") setValue(parent, key, value, [...path, key]);
      else throw new Error(`Unsupported op: ${op.op}`);
    }
  }

  function setValue(parent: any, key: A.Prop, value: unknown, path: A.Prop[]) {
    if (typeof value === "string" && typeof parent[key] === "string") A.updateText(draft, path, value);
    else parent[key] = value;
  }
}
