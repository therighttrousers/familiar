// Conversions between Automerge patches and JSON Patch (RFC 6902), from Spike 0.
//
// toJsonPatch: Automerge patches (from a handle's change event) -> JSON Patch,
// for showing user changes to the runtime agent.
//
// applyJsonPatch: JSON Patch -> mutations on an Automerge change-function draft,
// for applying the runtime agent's patch_state calls.

import * as A from "@automerge/automerge";
import type { Json, JsonPatchOp } from "protocol";

const escapeSegment = (seg: A.Prop) => String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
const pointer = (path: A.Prop[]) => path.map((s) => `/${escapeSegment(s)}`).join("");
const parsePointer = (path: string) =>
  path
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

// biome-ignore lint/suspicious/noExplicitAny: walks arbitrary JSON
function get(root: unknown, path: A.Prop[]): any {
  // biome-ignore lint/suspicious/noExplicitAny: walks arbitrary JSON
  let cur: any = root;
  for (const seg of path) cur = cur[seg];
  return cur;
}

function clone(v: unknown): Json {
  return v === undefined ? null : structuredClone(v as Json);
}

// Applies a JSON Patch op to a plain JSON value, in place. Only used to track the
// intermediate state while converting, so it supports only the ops we emit.
function applyToJson(root: unknown, op: JsonPatchOp): void {
  const segs = parsePointer(op.path);
  const key = segs.pop() as string;
  const parent = get(root, segs);
  if (Array.isArray(parent)) {
    const i = Number(key);
    if (op.op === "add") parent.splice(i, 0, clone(op.value));
    else if (op.op === "remove") parent.splice(i, 1);
    else parent[i] = clone(op.value);
  } else if (op.op === "remove") delete parent[key];
  else parent[key] = clone(op.value);
}

/** True if `op` makes `prev` redundant: both are whole-string replaces of the same string. */
export function supersedes(op: JsonPatchOp, prev: JsonPatchOp | undefined): boolean {
  return (
    op.op === "replace" &&
    prev?.op === "replace" &&
    prev.path === op.path &&
    typeof op.value === "string" &&
    typeof prev.value === "string"
  );
}

/**
 * Converts Automerge patches to JSON Patch. `before` is the JSON state the patches
 * apply to. Text edits (splices and deletes inside a string) become whole-string
 * `replace` ops, since JSON Patch has no string splice. Marks and conflicts are dropped.
 */
export function toJsonPatch(before: unknown, patches: A.Patch[]): JsonPatchOp[] {
  const state = { root: clone(before) };
  const ops: JsonPatchOp[] = [];
  const emit = (op: JsonPatchOp) => {
    if (supersedes(op, ops[ops.length - 1])) ops.pop();
    ops.push(op);
    applyToJson(state, { ...op, path: `/root${op.path}` });
  };

  for (const p of patches) {
    const parentPath = p.path.slice(0, -1);
    const key = p.path[p.path.length - 1] as A.Prop;
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
        p.values.forEach((v, j) => {
          emit({ op: "add", path: pointer([...parentPath, (key as number) + j]), value: clone(v) });
        });
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
        const s = parent as string;
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

/** Checks that an untrusted value is an array of JSON Patch ops Familiar supports. Throws if not. */
export function parseJsonPatch(input: unknown): JsonPatchOp[] {
  if (!Array.isArray(input)) throw new Error("patch must be an array of operations");
  return input.map((op, i): JsonPatchOp => {
    if (typeof op !== "object" || op === null) throw new Error(`patch[${i}] is not an object`);
    const { op: kind, path, value } = op as Record<string, unknown>;
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`patch[${i}].path must be a JSON Pointer below the root, e.g. "/spanish"`);
    }
    if (kind === "remove") return { op: kind, path };
    if (kind !== "add" && kind !== "replace") throw new Error(`patch[${i}].op must be add, replace or remove`);
    if (value === undefined) throw new Error(`patch[${i}].value is required`);
    return { op: kind, path, value: value as Json };
  });
}

/**
 * Applies JSON Patch ops to an Automerge draft inside a change function.
 * Whole-string replaces go through A.updateText, so they merge with concurrent
 * character-level edits instead of overwriting them. Throws on paths that don't resolve;
 * a throw inside a change function discards the whole change.
 */
// biome-ignore lint/suspicious/noExplicitAny: an Automerge draft of arbitrary shape
export function applyJsonPatch(draft: any, ops: JsonPatchOp[]): void {
  for (const op of ops) {
    const segs = parsePointer(op.path);
    const key = segs.pop() as string;
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
    if (Array.isArray(parent)) {
      const i = key === "-" ? parent.length : Number(key);
      const max = op.op === "add" ? parent.length : parent.length - 1;
      if (!Number.isInteger(i) || i < 0 || i > max) throw new Error(`Bad index: ${op.path}`);
      if (op.op === "add") parent.splice(i, 0, op.value);
      else if (op.op === "remove") parent.splice(i, 1);
      else setValue(parent, i, op.value, [...path, i]);
    } else {
      if (op.op !== "add" && !(key in parent)) throw new Error(`Path does not resolve: ${op.path}`);
      if (op.op === "remove") delete parent[key];
      else setValue(parent, key, op.value, [...path, key]);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: an Automerge draft of arbitrary shape
  function setValue(parent: any, key: A.Prop, value: Json, path: A.Prop[]) {
    if (typeof value === "string" && typeof parent[key] === "string") A.updateText(draft, path, value);
    else parent[key] = value;
  }
}
