// The per-session JSON Lines event log (see docs/designs/engineering.md#event-log-and-observability).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogEvent = { t: string } & Record<string, unknown>;

export class EventLog {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  write(event: LogEvent): void {
    appendFileSync(this.path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }
}
