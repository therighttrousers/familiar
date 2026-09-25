// Spike 0: automerge-repo sync behavior in the Familiar topology.
//
//   server (harness server) <—> ui (harness UI) <—> iframe (applet)
//
// Links are MessageChannels here; in Familiar, server↔ui is a websocket.

import * as A from "@automerge/automerge";
import { type DocHandle, type PeerId, Repo } from "@automerge/automerge-repo";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";
import { afterEach, describe, expect, test } from "vitest";

const repos: Repo[] = [];
afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.shutdown()));
});

function connect(a: Repo, b: Repo) {
  const { port1, port2 } = new MessageChannel();
  a.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(port1));
  b.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(port2));
}

function repo(peerId: string, config: ConstructorParameters<typeof Repo>[0] = {}) {
  const r = new Repo({ peerId: peerId as PeerId, ...config });
  repos.push(r);
  return r;
}

function bigState(n: number) {
  return { cells: Object.fromEntries(Array.from({ length: n }, (_, i) => [`A${i}`, `value ${i}`])) };
}

const timeout = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

describe("find() readiness for a doc created elsewhere", () => {
  test("created in one change: find() on another peer resolves with the full doc", async () => {
    const server = repo("server");
    const ui = repo("ui");
    connect(server, ui);
    for (let i = 0; i < 20; i++) {
      const h = server.create(bigState(2000));
      const found = await timeout(ui.find<any>(h.url));
      expect(A.getHeads(found.doc())).toEqual(A.getHeads(h.doc()));
    }
  });

  test("created with many changes: still complete when find() resolves", async () => {
    const server = repo("server");
    const ui = repo("ui");
    connect(server, ui);
    const h = server.create<any>({ cells: {} });
    for (let i = 0; i < 300; i++) h.change((d) => (d.cells[`A${i}`] = `v${i}`));
    const found = await timeout(ui.find<any>(h.url));
    expect(A.getHeads(found.doc())).toEqual(A.getHeads(h.doc()));
  });

  test("two hops: iframe finds a doc only the server has, through the ui", async () => {
    const server = repo("server");
    const ui = repo("ui");
    const iframe = repo("iframe");
    connect(server, ui);
    connect(ui, iframe);
    const h = server.create(bigState(500));
    const found = await timeout(iframe.find<any>(h.url));
    expect(A.getHeads(found.doc())).toEqual(A.getHeads(h.doc()));
  });
});

describe("shareConfig: can the ui refuse the iframe a doc?", () => {
  function setup() {
    let allowed: string | undefined;
    const server = repo("server");
    const ui = repo("ui", {
      shareConfig: {
        announce: async (peer) => peer !== "iframe",
        access: async (peer, docId) => peer !== "iframe" || docId === allowed,
      },
    });
    const iframe = repo("iframe");
    connect(server, ui);
    connect(ui, iframe);
    return { server, ui, iframe, allow: (h: DocHandle<unknown>) => (allowed = h.documentId) };
  }

  test("allowed doc: found", async () => {
    const { ui, iframe, allow } = setup();
    const h = ui.create({ x: 1 });
    allow(h);
    const found = await timeout(iframe.find<any>(h.url));
    expect(found.doc()).toEqual({ x: 1 });
  });

  test("disallowed doc the ui has: refused", async () => {
    const { ui, iframe, allow } = setup();
    allow(ui.create({ ok: true }));
    const secret = ui.create({ secret: true });
    await expect(timeout(iframe.find(secret.url))).rejects.toThrow(/unavailable/i);
  });

  test("disallowed doc only the server has: refused", async () => {
    const { server, iframe } = setup();
    const secret = server.create({ secret: true });
    await expect(timeout(iframe.find(secret.url))).rejects.toThrow(/unavailable/i);
  });

  test("allowed doc only the server has: found through the ui", async () => {
    const { server, iframe, allow } = setup();
    const h = server.create({ x: 2 });
    allow(h);
    const found = await timeout(iframe.find<any>(h.url));
    expect(found.doc()).toEqual({ x: 2 });
  });

  test("nothing is announced to the iframe", async () => {
    const { server, ui, iframe } = setup();
    const a = ui.create({ a: 1 });
    const b = server.create({ b: 1 });
    await ui.find(b.url);
    a.change((d: any) => (d.a = 2));
    await new Promise((r) => setTimeout(r, 300));
    expect(Object.keys(iframe.handles)).toEqual([]);
  });

  test("control: without revoking, changes reach the iframe within 300 ms", async () => {
    const { ui, iframe, allow } = setup();
    const h = ui.create<any>({ n: 0 });
    allow(h);
    const found = await timeout(iframe.find<any>(h.url));
    h.change((d) => (d.n = 1));
    await new Promise((r) => setTimeout(r, 300));
    expect(found.doc().n).toBe(1);
  });

  test("revoking access stops further sync to the iframe", async () => {
    const { ui, iframe, allow } = setup();
    const h = ui.create<any>({ n: 0 });
    allow(h);
    const found = await timeout(iframe.find<any>(h.url));
    allow(ui.create({})); // activate a different doc
    ui.shareConfigChanged();
    h.change((d) => (d.n = 1));
    await new Promise((r) => setTimeout(r, 300));
    expect(found.doc().n).toBe(0);
  });
});
