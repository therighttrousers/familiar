// Types shared by the harness, the harness UI, the runner and the applet runtime.
// Types only: nothing imports this package at runtime.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A JSON Patch (RFC 6902) operation, limited to the ops Familiar uses. */
export type JsonPatchOp =
  | { op: "add"; path: string; value: Json }
  | { op: "replace"; path: string; value: Json }
  | { op: "remove"; path: string };

// Runner <-> harness server (JSON over a websocket). The runner is untrusted:
// the harness validates everything it receives.

export type RpcRequest =
  | { type: "rpc"; id: number; method: "get_state" }
  | { type: "rpc"; id: number; method: "patch_state"; patch: unknown };

export type RpcResponse =
  | { type: "rpc-result"; id: number; ok: true; result: Json }
  | { type: "rpc-result"; id: number; ok: false; error: string };

/** What the runner reports from the Agent SDK's message stream. */
export type RunnerEvent =
  | { t: "agent.init"; model: string; sessionId: string }
  | { t: "agent.text"; text: string }
  | { t: "agent.tool"; name: string; input: unknown }
  | { t: "agent.result"; subtype: string; durationMs: number; costUsd: number; turns: number }
  | { t: "agent.error"; message: string };

export type RunnerToHarness = RpcRequest | { type: "event"; event: RunnerEvent };

/** Harness -> runner: one input message for the runtime agent, already encoded. */
export type HarnessToRunner = RpcResponse | { type: "input"; text: string };

// Harness server -> harness UI (JSON websocket).

export type AgentStatus =
  /** No runner connected. */
  | { state: "disconnected" }
  | { state: "idle" }
  /** The harness is holding a batch of changes until the user pauses. */
  | { state: "batching" }
  | { state: "working"; activity?: string };

export type HarnessToUi = { type: "status"; status: AgentStatus; lastTurn?: { durationMs: number; costUsd: number } };

/** GET /api/session */
export type SessionInfo = {
  sessionId: string;
  /** automerge-repo URL of the state doc. */
  docUrl: string;
  /** The harness server's automerge-repo peer ID. Unguessable: the harness UI trusts only this peer. */
  serverPeerId: string;
  /** Origin the applet iframe loads from. */
  appletOrigin: string;
};

// Harness UI <-> applet iframe (postMessage).

/** Iframe -> parent: the loader is ready for a connection. */
export type AppletReady = { type: "familiar:ready" };
/** Parent -> iframe, with a MessagePort for automerge-repo sync transferred alongside. */
export type AppletConnect = { type: "familiar:connect"; docUrl: string };
