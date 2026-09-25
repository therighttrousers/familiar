// The harness UI's automerge-repo peer. It syncs with the harness server, and relays
// only the active state doc to the applet iframe (see docs/designs/state.md#documents).

import { type AutomergeUrl, type DocHandle, type PeerId, parseAutomergeUrl, Repo } from "@automerge/automerge-repo";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import type { AppletConnect, AppletReady, SessionInfo } from "protocol";

export type Connection = { info: SessionInfo; repo: Repo; handle: DocHandle<unknown> };

export async function connect(): Promise<Connection> {
  const info = (await (await fetch("/api/session")).json()) as SessionInfo;
  const activeDocId = parseAutomergeUrl(info.docUrl as AutomergeUrl).documentId;
  const repo = new Repo({
    network: [new WebSocketClientAdapter(`ws://${location.host}/sync`)],
    peerId: `harness-ui-${crypto.randomUUID()}` as PeerId,
    // Default deny: the server's unguessable peer ID is the only trusted peer. Every other
    // peer (the applet iframe) gets the active state doc only, and is announced nothing.
    shareConfig: {
      announce: async (peerId) => peerId === info.serverPeerId,
      access: async (peerId, documentId) => peerId === info.serverPeerId || documentId === activeDocId,
    },
  });
  const handle = await repo.find(info.docUrl as AutomergeUrl);
  return { info, repo, handle };
}

/** Answers the applet loader's "ready" messages with a MessagePort for syncing the active state doc. */
export function hostApplet(conn: Connection, iframe: HTMLIFrameElement): () => void {
  const onMessage = (e: MessageEvent<AppletReady>) => {
    if (e.origin !== conn.info.appletOrigin || e.source !== iframe.contentWindow || e.data?.type !== "familiar:ready")
      return;
    const { port1, port2 } = new MessageChannel();
    conn.repo.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(port1));
    const msg: AppletConnect = { type: "familiar:connect", docUrl: conn.info.docUrl };
    iframe.contentWindow?.postMessage(msg, conn.info.appletOrigin, [port2]);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
