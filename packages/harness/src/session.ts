// Per-session harness state (see docs/designs/engineering.md#harness-structure).
// No process-global singletons: everything a session needs hangs off this object.

import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { AgentStatus, HarnessToRunner, HarnessToUi, Json, RunnerEvent, RunnerToHarness } from "protocol";
import { Batcher } from "./batcher.ts";
import { encodeChanges } from "./encoding.ts";
import type { EventLog } from "./eventlog.ts";
import { applyJsonPatch, parseJsonPatch, toJsonPatch } from "./jsonpatch.ts";

export type SessionOptions = {
  id: string;
  repo: Repo;
  initialState: { [key: string]: Json };
  log: EventLog;
  idleMs?: number;
  maxMs?: number;
};

/** The harness's end of a runner connection. */
export type RunnerLink = { send(msg: HarnessToRunner): void };

type UiListener = (msg: HarnessToUi) => void;

export class Session {
  readonly id: string;
  readonly handle: DocHandle<{ [key: string]: Json }>;
  readonly log: EventLog;

  #runner: RunnerLink | undefined;
  /** Inputs flushed while no runner was connected. */
  #queued: string[] = [];
  #batcher: Batcher;
  /** True while the harness applies the runtime agent's patch, so its own change isn't batched back to it (G8). */
  #applyingAgentChange = false;
  #working = false;
  #activity: string | undefined;
  #lastTurn: HarnessToUi["lastTurn"];
  #listeners = new Set<UiListener>();
  #lastPublished: string | undefined;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.log = opts.log;
    this.handle = opts.repo.create(opts.initialState);
    this.#batcher = new Batcher({
      idleMs: opts.idleMs ?? 1500,
      maxMs: opts.maxMs ?? 5000,
      onFlush: (patch) => {
        this.log.write({ t: "user.changes", patch });
        this.#sendInput(encodeChanges(patch));
      },
      onPendingChange: () => this.#publishStatus(),
    });
    this.handle.on("change", ({ patches, patchInfo }) => {
      if (this.#applyingAgentChange) return;
      this.#batcher.add(toJsonPatch(patchInfo.before, patches));
    });
    this.log.write({ t: "harness.session", id: this.id, docUrl: this.handle.url, state: opts.initialState });
  }

  // --- Runner ---

  /** Connects a runner, replacing any previous one. Returns a function that disconnects it. */
  attachRunner(link: RunnerLink): () => void {
    this.#runner = link;
    this.#working = false;
    this.log.write({ t: "harness.runner", connected: true });
    for (const text of this.#queued.splice(0)) this.#sendInput(text);
    this.#publishStatus();
    return () => {
      if (this.#runner !== link) return;
      this.#runner = undefined;
      this.#working = false;
      this.log.write({ t: "harness.runner", connected: false });
      this.#publishStatus();
    };
  }

  /** Handles a message from the (untrusted) runner. */
  handleRunnerMessage(raw: unknown): void {
    const msg = raw as RunnerToHarness;
    if (msg?.type === "event") this.#handleEvent(msg.event);
    else if (msg?.type === "rpc" && typeof msg.id === "number") {
      let response: HarnessToRunner;
      try {
        response = { type: "rpc-result", id: msg.id, ok: true, result: this.#rpc(msg) };
      } catch (e) {
        response = { type: "rpc-result", id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      this.log.write({
        t: "harness.rpc",
        method: msg.method,
        ok: response.ok,
        ...(response.ok ? {} : { error: response.error }),
      });
      this.#runner?.send(response);
    }
  }

  #rpc(msg: Extract<RunnerToHarness, { type: "rpc" }>): Json {
    switch (msg.method) {
      case "get_state":
        return this.state();
      case "patch_state": {
        const ops = parseJsonPatch(msg.patch);
        this.#applyingAgentChange = true;
        try {
          this.handle.change((draft) => applyJsonPatch(draft, ops));
        } finally {
          this.#applyingAgentChange = false;
        }
        return `Applied ${ops.length} operation${ops.length === 1 ? "" : "s"}.`;
      }
      default:
        throw new Error(`Unknown method: ${(msg as { method: unknown }).method}`);
    }
  }

  #handleEvent(event: RunnerEvent): void {
    if (typeof event?.t !== "string" || !event.t.startsWith("agent.")) return;
    this.log.write(event);
    switch (event.t) {
      case "agent.text":
        this.#working = true;
        break;
      case "agent.tool":
        this.#working = true;
        this.#activity = event.name.replace(/^mcp__\w+__/, "");
        break;
      case "agent.result":
        this.#working = false;
        this.#activity = undefined;
        this.#lastTurn = { durationMs: event.durationMs, costUsd: event.costUsd };
        break;
    }
    this.#publishStatus();
  }

  #sendInput(text: string): void {
    if (!this.#runner) {
      this.#queued.push(text);
      return;
    }
    this.log.write({ t: "harness.input", text });
    this.#runner.send({ type: "input", text });
    this.#working = true;
    this.#publishStatus();
  }

  // --- State ---

  state(): { [key: string]: Json } {
    return JSON.parse(JSON.stringify(this.handle.doc()));
  }

  // --- Harness UI ---

  status(): AgentStatus {
    if (this.#working) return this.#activity ? { state: "working", activity: this.#activity } : { state: "working" };
    if (this.#batcher.pending) return { state: "batching" };
    if (!this.#runner) return { state: "disconnected" };
    return { state: "idle" };
  }

  subscribe(listener: UiListener): () => void {
    this.#listeners.add(listener);
    listener(this.#statusMessage());
    return () => this.#listeners.delete(listener);
  }

  #statusMessage(): HarnessToUi {
    return { type: "status", status: this.status(), ...(this.#lastTurn ? { lastTurn: this.#lastTurn } : {}) };
  }

  #publishStatus(): void {
    const msg = this.#statusMessage();
    const json = JSON.stringify(msg);
    if (json === this.#lastPublished) return;
    this.#lastPublished = json;
    for (const l of this.#listeners) l(msg);
  }

  dispose(): void {
    this.#batcher.dispose();
  }
}
