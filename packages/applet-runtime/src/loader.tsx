// The loader (PoC 1: trivial). It asks the parent page for a connection, syncs the one
// state doc over the MessagePort it's given, and renders the applet.
// See docs/designs/code-versions.md#loader for what the real loader will do.

import Applet from "@applet/main";
import { type AutomergeUrl, type PeerId, Repo } from "@automerge/automerge-repo";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import type { AppletConnect, AppletReady } from "protocol";
import { createRoot } from "react-dom/client";
import { connectStore } from "./state.ts";

let connected = false;

window.addEventListener("message", async (e: MessageEvent<AppletConnect>) => {
  const port = e.ports[0];
  if (connected || e.source !== window.parent || e.data?.type !== "familiar:connect" || !port) return;
  connected = true;
  const repo = new Repo({
    network: [new MessageChannelNetworkAdapter(port)],
    peerId: `applet-${crypto.randomUUID()}` as PeerId,
  });
  const handle = await repo.find(e.data.docUrl as AutomergeUrl);
  connectStore(handle);
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Applet />);
});

window.parent.postMessage({ type: "familiar:ready" } satisfies AppletReady, "*");
