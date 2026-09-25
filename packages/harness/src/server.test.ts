// The harness end to end, without a model: a harness UI peer edits the state doc over
// the sync websocket, and a fake runner answers over the runner websocket.

import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AutomergeUrl, type PeerId, Repo, updateText } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import type { HarnessToRunner, HarnessToUi, Json, RunnerToHarness, SessionInfo } from "protocol";
import { afterEach, beforeEach, expect, test } from "vitest";
import { EventLog } from "./eventlog.ts";
import { createHarness, type Harness } from "./server.ts";

type State = { english: string; spanish: string };

let harness: Harness;
let base: string;
const closers: (() => unknown)[] = [];

beforeEach(async () => {
  const log = new EventLog(join(mkdtempSync(join(tmpdir(), "familiar-")), "log.jsonl"));
  harness = createHarness({
    initialState: { english: "", spanish: "" },
    log,
    sessionId: "test",
    appletOrigin: "http://localhost:5174",
    runnerToken: "secret",
    idleMs: 50,
    maxMs: 500,
  });
  await new Promise<void>((resolve) => harness.server.listen(0, resolve));
  base = `localhost:${(harness.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await harness.close();
});

async function until<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
}

async function fakeRunner() {
  const ws = new WebSocket(`ws://${base}/runner?token=secret`);
  const inputs: string[] = [];
  const results = new Map<number, HarnessToRunner>();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as HarnessToRunner;
    if (msg.type === "input") inputs.push(msg.text);
    else results.set(msg.id, msg);
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  closers.push(() => ws.close());
  let id = 0;
  return {
    inputs,
    async rpc(call: { method: "get_state" } | { method: "patch_state"; patch: unknown }) {
      const msg = { type: "rpc", id: ++id, ...call } as RunnerToHarness;
      ws.send(JSON.stringify(msg));
      return until(() => results.get(id));
    },
  };
}

async function uiPeer() {
  const info = (await (await fetch(`http://${base}/api/session`)).json()) as SessionInfo;
  const repo = new Repo({ network: [new WebSocketClientAdapter(`ws://${base}/sync`)], peerId: "ui" as PeerId });
  closers.push(() => repo.shutdown());
  return repo.find<State>(info.docUrl as AutomergeUrl);
}

test("user edits reach the runner as one batch; the runtime agent's patch reaches the user and isn't echoed back", async () => {
  const runner = await fakeRunner();
  const doc = await uiPeer();

  for (const text of ["h", "he", "hello"]) doc.change((d) => updateText(d, ["english"], text));
  const input = await until(() => runner.inputs[0]);
  expect(input).toBe(
    '<applet-changes source="user">\n[{"op":"replace","path":"/english","value":"hello"}]\n</applet-changes>',
  );

  const result = await runner.rpc({
    method: "patch_state",
    patch: [{ op: "replace", path: "/spanish", value: "hola" }],
  });
  expect(result).toMatchObject({ ok: true });
  await until(() => (doc.doc().spanish === "hola" ? true : undefined));

  await new Promise((r) => setTimeout(r, 200));
  expect(runner.inputs).toHaveLength(1);
});

test("a patch with a bad path is rejected and changes nothing", async () => {
  const runner = await fakeRunner();
  const result = await runner.rpc({
    method: "patch_state",
    patch: [
      { op: "replace", path: "/spanish", value: "hola" },
      { op: "replace", path: "/french", value: "salut" },
    ],
  });
  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/does not resolve/) });
  expect(await runner.rpc({ method: "get_state" })).toMatchObject({ ok: true, result: { english: "", spanish: "" } });
});

test("changes made before the runner connects are delivered when it does", async () => {
  const doc = await uiPeer();
  doc.change((d) => updateText(d, ["english"], "early"));
  await new Promise((r) => setTimeout(r, 150));
  const runner = await fakeRunner();
  expect(await until(() => runner.inputs[0])).toContain('"value":"early"');
});

test("the harness UI sees status changes", async () => {
  const ws = new WebSocket(`ws://${base}/events`);
  closers.push(() => ws.close());
  const states: string[] = [];
  ws.addEventListener("message", (e) => states.push((JSON.parse(String(e.data)) as HarnessToUi).status.state));
  await until(() => states[0]);
  expect(states).toEqual(["disconnected"]);

  const runner = await fakeRunner();
  const doc = await uiPeer();
  doc.change((d) => updateText(d, ["english"], "hi"));
  await until(() => runner.inputs[0]);
  harness.session.handleRunnerMessage({
    type: "event",
    event: { t: "agent.result", subtype: "success", durationMs: 1, costUsd: 0, turns: 1 },
  });
  await until(() => (states.at(-1) === "idle" && states.includes("working") ? true : undefined));
  expect(states).toEqual(["disconnected", "idle", "batching", "working", "idle"]);
});

test("the runner websocket needs the token, and the event log records the session", async () => {
  const ws = new WebSocket(`ws://${base}/runner?token=wrong`);
  await expect(
    new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    }),
  ).rejects.toBeDefined();

  const runner = await fakeRunner();
  await runner.rpc({ method: "patch_state", patch: [{ op: "replace", path: "/spanish", value: "hola" }] });
  const events = readFileSync(harness.session.log.path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { t: string } & Record<string, Json>);
  expect(events.map((e) => e.t)).toEqual(["harness.session", "harness.runner", "harness.rpc"]);
});
