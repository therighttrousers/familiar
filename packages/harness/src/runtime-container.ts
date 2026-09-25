// Starts and stops the runtime agent container (PoC deployment: see docs/designs/roadmap.md#poc-1-live-translation).

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export type ContainerOptions = {
  image: string;
  name: string;
  /** File with CLAUDE_CODE_OAUTH_TOKEN, passed to the container (an accepted PoC gap). */
  envFile: string;
  harnessUrl: string;
  runnerToken: string;
  model: string;
  appletPort: number;
};

export function startRuntimeContainer(opts: ContainerOptions): { stop(): void } {
  if (!existsSync(opts.envFile)) throw new Error(`Missing ${opts.envFile}: it must set CLAUDE_CODE_OAUTH_TOKEN`);
  // A previous harness run may have left one behind.
  spawnSync("docker", ["rm", "-f", opts.name], { stdio: "ignore" });
  const args = [
    "run",
    "--rm",
    "--name",
    opts.name,
    "--env-file",
    opts.envFile,
    "-e",
    `HARNESS_URL=${opts.harnessUrl}`,
    "-e",
    `RUNNER_TOKEN=${opts.runnerToken}`,
    "-e",
    `MODEL=${opts.model}`,
    "-p",
    `127.0.0.1:${opts.appletPort}:8080`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "2g",
    "--pids-limit",
    "512",
    opts.image,
  ];
  const child: ChildProcess = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter((l) => l)
      .map((l) => `[runtime] ${l}\n`)
      .join("");
  child.stdout?.on("data", (c: Buffer) => process.stdout.write(prefix(c)));
  child.stderr?.on("data", (c: Buffer) => process.stderr.write(prefix(c)));
  child.on("exit", (code) => console.log(`[runtime] container exited (${code})`));
  return {
    stop() {
      spawnSync("docker", ["rm", "-f", opts.name], { stdio: "ignore" });
    },
  };
}
