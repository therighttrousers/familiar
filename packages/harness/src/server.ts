// The harness server's HTTP and websocket endpoints:
//   GET /api/session   session info for the harness UI
//   /sync              automerge-repo sync with the harness UI
//   /events            JSON status stream for the harness UI
//   /runner            the runner's RPC and events

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { type PeerId, Repo } from "@automerge/automerge-repo";
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket";
import type { Json, SessionInfo } from "protocol";
import { WebSocketServer } from "ws";
import type { EventLog } from "./eventlog.ts";
import { Session } from "./session.ts";

export type HarnessOptions = {
  initialState: { [key: string]: Json };
  log: EventLog;
  sessionId: string;
  appletOrigin: string;
  /** The runner must present this token. */
  runnerToken: string;
  idleMs?: number;
  maxMs?: number;
};

export type Harness = { server: Server; session: Session; repo: Repo; close(): Promise<void> };

export function createHarness(opts: HarnessOptions): Harness {
  const syncWss = new WebSocketServer({ noServer: true });
  const eventsWss = new WebSocketServer({ noServer: true });
  const runnerWss = new WebSocketServer({ noServer: true });

  // The harness UI trusts only this peer, so the ID must be unguessable.
  const serverPeerId = `harness-${randomUUID()}` as PeerId;
  // biome-ignore lint/suspicious/noExplicitAny: ws versions differ slightly between packages
  const repo = new Repo({ network: [new NodeWSServerAdapter(syncWss as any)], peerId: serverPeerId });

  const session = new Session({
    id: opts.sessionId,
    repo,
    initialState: opts.initialState,
    log: opts.log,
    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
    ...(opts.maxMs !== undefined ? { maxMs: opts.maxMs } : {}),
  });

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/session") {
      const info: SessionInfo = {
        sessionId: session.id,
        docUrl: session.handle.url,
        serverPeerId,
        appletOrigin: opts.appletOrigin,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(info));
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/sync") syncWss.handleUpgrade(req, socket, head, (ws) => syncWss.emit("connection", ws, req));
    else if (url.pathname === "/events")
      eventsWss.handleUpgrade(req, socket, head, (ws) => eventsWss.emit("connection", ws, req));
    else if (url.pathname === "/runner" && url.searchParams.get("token") === opts.runnerToken) {
      runnerWss.handleUpgrade(req, socket, head, (ws) => runnerWss.emit("connection", ws, req));
    } else socket.destroy();
  });

  eventsWss.on("connection", (ws) => {
    const unsubscribe = session.subscribe((msg) => ws.send(JSON.stringify(msg)));
    ws.on("close", unsubscribe);
  });

  runnerWss.on("connection", (ws) => {
    const detach = session.attachRunner({ send: (msg) => ws.send(JSON.stringify(msg)) });
    ws.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      session.handleRunnerMessage(msg);
    });
    ws.on("close", detach);
  });

  return {
    server,
    session,
    repo,
    async close() {
      session.dispose();
      for (const wss of [eventsWss, runnerWss, syncWss]) for (const c of wss.clients) c.terminate();
      await repo.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
