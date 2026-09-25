// Starts the harness server for one session, and the runtime agent container.
//
// Environment:
//   HARNESS_PORT        default 5170
//   APPLET_PORT         host port for the container's applet server, default 5174
//   FAMILIAR_MODEL      the runtime agent's model, default claude-sonnet-5
//   FAMILIAR_RUNTIME    "docker" (default) starts the container; "external" waits for a runner started elsewhere

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog } from "./eventlog.ts";
import { startRuntimeContainer } from "./runtime-container.ts";
import { createHarness } from "./server.ts";

const root = join(import.meta.dirname, "../../..");
const port = Number(process.env.HARNESS_PORT ?? 5170);
const appletPort = Number(process.env.APPLET_PORT ?? 5174);
const model = process.env.FAMILIAR_MODEL ?? "claude-sonnet-5";
const runtime = process.env.FAMILIAR_RUNTIME ?? "docker";

const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
const initialState = JSON.parse(readFileSync(join(root, "packages/translation-applet/initial-state.json"), "utf8"));
const log = new EventLog(join(root, "logs", `${sessionId}.jsonl`));
const runnerToken = process.env.RUNNER_TOKEN ?? randomBytes(24).toString("hex");

const harness = createHarness({
  initialState,
  log,
  sessionId,
  appletOrigin: `http://localhost:${appletPort}`,
  runnerToken,
});

harness.server.listen(port, () => {
  console.log(`[harness] session ${sessionId} on http://localhost:${port}`);
  console.log(`[harness] event log: ${log.path}`);
});

let container: { stop(): void } | undefined;
if (runtime === "docker") {
  container = startRuntimeContainer({
    image: "familiar-runtime-agent",
    name: "familiar-runtime-agent",
    envFile: join(root, ".env"),
    harnessUrl: `ws://host.docker.internal:${port}/runner?token=${runnerToken}`,
    runnerToken,
    model,
    appletPort,
  });
} else {
  console.log(`[harness] waiting for an external runner: ws://localhost:${port}/runner?token=${runnerToken}`);
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  container?.stop();
  void harness.close().finally(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
