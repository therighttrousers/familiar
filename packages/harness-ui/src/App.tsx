import type { HarnessToUi } from "protocol";
import { useEffect, useRef, useState } from "react";
import { type Connection, connect, hostApplet } from "./connection.ts";

export function App() {
  const [conn, setConn] = useState<Connection>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    connect().then(setConn, (e) => setError(String(e)));
  }, []);

  if (error) return <div className="message">Can't reach the harness: {error}</div>;
  if (!conn) return <div className="message">Connecting…</div>;
  return (
    <div className="app">
      <StatusBar />
      <AppletFrame conn={conn} />
    </div>
  );
}

function AppletFrame({ conn }: { conn: Connection }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => (ref.current ? hostApplet(conn, ref.current) : undefined), [conn]);
  return <iframe ref={ref} className="applet" title="Applet" src={`${conn.info.appletOrigin}/`} />;
}

const labels = {
  disconnected: "Runtime agent not connected",
  idle: "Ready",
  batching: "Waiting for you to pause…",
  working: "Working…",
} as const;

function StatusBar() {
  const [msg, setMsg] = useState<HarnessToUi>();
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      ws = new WebSocket(`ws://${location.host}/events`);
      ws.onmessage = (e) => setMsg(JSON.parse(e.data));
      ws.onclose = () => {
        setMsg(undefined);
        retry = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      if (ws) ws.onclose = null;
      ws?.close();
    };
  }, []);

  const status = msg?.status;
  const text = !status
    ? "Harness not connected"
    : status.state === "working" && status.activity
      ? `Working: ${status.activity}`
      : labels[status.state];
  return (
    <div className={`status status-${status?.state ?? "offline"}`} role="status">
      <div className="bar" />
      <span>{text}</span>
      {msg?.lastTurn && (
        <span className="turn">
          last turn {(msg.lastTurn.durationMs / 1000).toFixed(1)} s · ${msg.lastTurn.costUsd.toFixed(3)} session (est.)
        </span>
      )}
    </div>
  );
}
