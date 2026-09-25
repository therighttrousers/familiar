// The runner: drives the Agent SDK with streaming input, and hosts the runtime tools,
// which call the harness server's RPC (see docs/designs/runtime-agent.md#runner).
//
// Environment:
//   HARNESS_URL         the harness's runner websocket, including its token
//   MODEL               default claude-sonnet-5
//   WORK_DIR            the runtime agent's working directory, default the current directory
//   SCENARIO_FILE       optional text appended to the system prompt

import { readFileSync } from "node:fs";
import { createSdkMcpServer, query, type SDKUserMessage, tool } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessToRunner, Json, RunnerEvent, RunnerToHarness } from "protocol";
import { z } from "zod";
import { Inbox } from "./inbox.ts";

const harnessUrl = process.env.HARNESS_URL;
if (!harnessUrl) throw new Error("HARNESS_URL is required");
const model = process.env.MODEL ?? "claude-sonnet-5";
const workDir = process.env.WORK_DIR ?? process.cwd();
const scenario = process.env.SCENARIO_FILE ? readFileSync(process.env.SCENARIO_FILE, "utf8") : undefined;

const inbox = new Inbox<SDKUserMessage>();
const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
let nextId = 1;

const ws = new WebSocket(harnessUrl);
const send = (msg: RunnerToHarness) => ws.send(JSON.stringify(msg));
const emit = (event: RunnerEvent) => send({ type: "event", event });

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(String(e.data)) as HarnessToRunner;
  if (msg.type === "input") {
    inbox.push({ type: "user", message: { role: "user", content: msg.text }, parent_tool_use_id: null });
  } else if (msg.type === "rpc-result") {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p?.resolve(msg.result);
    else p?.reject(new Error(msg.error));
  }
});
// The harness owns the session. Without it there's nothing to do; it starts a fresh container.
ws.addEventListener("close", () => {
  console.log("[runner] harness disconnected; exiting");
  process.exit(0);
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
console.log(`[runner] connected; model ${model}`);

type RpcCall = { method: "get_state" } | { method: "patch_state"; patch: unknown };
function rpc(call: RpcCall): Promise<Json> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: "rpc", id, ...call } as RunnerToHarness);
  });
}

async function toolResult(call: RpcCall) {
  try {
    const result = await rpc(call);
    return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

const familiar = createSdkMcpServer({
  name: "familiar",
  version: "0.1.0",
  tools: [
    tool("get_state", "Returns the applet's current state as JSON.", {}, () => toolResult({ method: "get_state" })),
    tool(
      "patch_state",
      "Changes the applet's state with a JSON Patch (RFC 6902): an array of add, replace and remove operations. " +
        'Paths are JSON Pointers into the state, e.g. "/spanish". A replace of a string replaces the whole string. ' +
        "The patch applies atomically: if any path doesn't resolve, nothing changes and you get an error.",
      {
        patch: z.array(
          z.object({
            op: z.enum(["add", "replace", "remove"]),
            path: z.string(),
            value: z.any().optional(),
          }),
        ),
      },
      ({ patch }) => toolResult({ method: "patch_state", patch }),
    ),
  ],
});

const session = query({
  prompt: inbox,
  options: {
    model,
    cwd: workDir,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers: { familiar },
    settingSources: ["project"],
    systemPrompt: scenario
      ? { type: "preset", preset: "claude_code", append: scenario }
      : { type: "preset", preset: "claude_code" },
    stderr: (data) => process.stderr.write(data),
  },
});

try {
  for await (const m of session) {
    if (m.type === "system" && m.subtype === "init") {
      console.log(`[runner] session ${m.session_id}; auth ${m.apiKeySource}`);
      emit({ t: "agent.init", model: m.model, sessionId: m.session_id });
    } else if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type === "text") emit({ t: "agent.text", text: block.text });
        else if (block.type === "tool_use") emit({ t: "agent.tool", name: block.name, input: block.input });
      }
    } else if (m.type === "result") {
      emit({
        t: "agent.result",
        subtype: m.subtype,
        durationMs: m.duration_ms,
        costUsd: m.total_cost_usd,
        turns: m.num_turns,
      });
    }
  }
} catch (e) {
  emit({ t: "agent.error", message: e instanceof Error ? e.message : String(e) });
  throw e;
}
