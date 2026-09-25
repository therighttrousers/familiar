// Renders the runtime agent's input messages (see docs/designs/runtime-agent.md#message-encoding).

import type { JsonPatchOp } from "protocol";

export function encodeChanges(patch: JsonPatchOp[]): string {
  return `<applet-changes source="user">\n${JSON.stringify(patch)}\n</applet-changes>`;
}
