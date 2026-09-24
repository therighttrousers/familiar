# Code versions

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.3, §1.5, §4.1–4.5

## Immutable built versions

- The runtime agent edits applet source in **`work/`**, a git repo in the runtime agent container.
- Each publish produces an **immutable build** in `dist/v{n}/`. Nothing is edited in place and nothing is hot-reloaded.
- The control doc's pointer names the **active version** by an **opaque version ID** (`v{n}`), not a directory. The loader resolves "version ID → entry URL" and imports the entry. In dev, that's `/v{n}/main.js` from `dist/v{n}/` on the runtime agent container's static server; in the cloud, a bundle URL (see [roadmap](roadmap.md#deployment-contexts)).
- A **static server in the runtime agent container** serves `dist/` and the loader. There is no Vite dev server and no HMR in the applet path, so correctness never depends on HMR or Fast Refresh.
- Each version declares which schema version it reads. Code versions without a schema change share a state doc.
- Revert can go back **any number of versions**.

Why: no HMR/watcher uncertainty, unlimited rollback, and dev matches the cloud shape. A toy-applet build takes a second or two, negligible next to a runtime agent turn. (000 §4.1)

## Publish pipeline

`publish_applet` (a runtime tool; see [runtime agent](runtime-agent.md#tools)) runs in the runtime agent container:

1. `tsc --noEmit` on `work/`.
2. `vite build` of `work/` into `dist/v{n}/`.
3. If `migrate.ts` exists: get a fresh state snapshot from the harness and run `migrate` (see [state](state.md#schema-changes)).
4. Send the code version (and migrated state, if any) to the harness. The harness creates the new state doc if there is one, then **activates** the new version: code version and state doc change together, in one control-doc change.
5. After the harness confirms: archive `migrate.ts` and commit `work/`.

**Validation gate:** any failure in steps 1–3 stops the publish. Nothing is activated, and the errors go back to the runtime agent as the tool result, so it can fix and retry. There are no tests or smoke renders in the MVP. (000 §4.3)

The [architecture overview](high-level-design.md#architecture-overview) has a sequence diagram of this pipeline.

## Loader

A small **protected** loader runs in the applet iframe.

- It receives the pointer from the parent page via `postMessage` and follows it.
- It owns the React root and renders the version's `Applet`.
- An **import map** maps `react`, `react-dom` and `@harness/state` to single shared copies. Applet builds mark them external, so every version shares one React and hooks keep working.
- **Readiness:** when a version is activated, it keeps rendering the old version until automerge-repo reports the new state doc ready (`whenReady()`), then imports the new version's entry and switches. This is needed because Automerge doesn't order writes across docs, and the pointer travels separately by `postMessage`.

Post-MVP: a richer loader, e.g. an error boundary that notifies the runtime agent and triggers rollback.

## Rollback

- The **Revert** button in the harness UI (see [ux](ux.md#undo-and-history)) **reactivates the previous version** (code + state doc). Any earlier version can be activated the same way. The harness does this by writing the control doc, with no help from the runtime agent container (G7).
- The harness then notifies the runtime agent, so it doesn't build on the rejected version.
- `work/` keeps the rejected code. Git history lets the runtime agent restore earlier versions.

Post-MVP: automatic rollback triggered by the loader's error boundary.

## Applet code conventions

- **Entry point:** `main.tsx` default-exports `Applet`, and nothing else.
- **State:** `@harness/state`'s `store` (see [state](state.md#in-applet-store-api)). `State` is defined in `schema.ts`.
- **Styling:** Tailwind v4, via the Vite plugin in the protected config.
- **Components:** shadcn/ui, generated into `work/components/ui/` at bootstrap. It is light, Tailwind-native, and lives as source the runtime agent can modify. (The original project found a component library cheap and valuable; MUI was too heavy.)
- **Preinstalled packages:** React, React DOM, Tailwind, shadcn's dependencies (Radix, `lucide-react`), `@harness/state`. **No domain libraries** (e.g. no `chess.js`): the runtime agent builds the smarts itself. There is no `npm install` in the MVP (see [security](security.md#egress)).
- **Protected files** (root-owned, read-only to the runtime agent): `vite.config.ts`, the loader, `@harness/state`.
- **Bootstrap applet:** a near-blank canvas with a short, friendly, centered label saying what to do, published as `dist/v0/` (see [ux](ux.md#layout)).

## Open questions

- **How a version declares its schema version** (000 §4.1 says it does, not how). The runtime agent's input (`schema="3"`) and the event log assume a schema number.
- **Remounting on activation (000 §4.2, Spike 0).** `v7/Applet` and `v8/Applet` are different component types, so React will likely remount the whole tree on activation. That would lose React state and recreate the DOM (focus, half-typed input, scroll, selection). Plan: spike it first, with no workarounds unless the spike says we need them. The known fix is the original project's approach: a stable wrapper component type that renders the loaded code, in the loader.
- **Import map (Spike 0):** confirm that one React is shared across separately built versions.
