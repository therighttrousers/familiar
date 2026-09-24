# Code versions

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.3, §1.5, §4.1–4.5

## Immutable built versions

- The runtime agent edits applet source in **`work/`**, a git repo in the runtime agent container.
- Each publish produces an **immutable build** in `dist/v{n}/`. Nothing is edited in place and nothing is hot-reloaded.
- The control doc's pointer names the **active version** by an **opaque version ID** (`v{n}`), not a directory. The loader resolves "version ID → entry URL" and imports the entry. In dev, that's `/v{n}/main.js` from `dist/v{n}/` on the runtime agent container's static server; in the cloud, a bundle URL (see [roadmap](roadmap.md#deployment-contexts)).
- A **static server in the runtime agent container** serves `dist/` and the loader. There is no Vite dev server and no HMR in the applet path, so correctness never depends on HMR. The loader uses React Refresh's runtime only to keep UI state across activations (see [loader](#preserving-ui-state-across-activations)); if that fails, the cost is a remount, not wrong behavior.
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
- An **import map** maps `react`, `react/jsx-runtime`, `react-dom/client` and `@harness/state` to single shared copies. Applet builds mark them external, so every version shares one React and hooks keep working (confirmed in Spike 0). React ships only CommonJS, so the shared copies are ESM wrappers built with explicit named exports, bundled together so React exists once.
- **Readiness:** when a version is activated, it keeps rendering the old version until automerge-repo reports the new state doc ready, then imports the new version's entry and switches. This is needed because Automerge doesn't order writes across docs, and the pointer travels separately by `postMessage`. In automerge-repo 2.x, `repo.find()` resolves once the handle is ready. In Spike 0 it always resolved with the complete doc (identical heads) for a doc created on another peer, including through two hops (server → UI → iframe). The source says it has no `whenSynced()`, and a doc already stored locally counts as ready before syncing, but the loader never has the new doc locally.

### Preserving UI state across activations

The loader uses **React Refresh** (the runtime behind Fast Refresh, without HMR), so activating a version keeps React state and the DOM: half-typed input, focus, selection, scroll, and uncontrolled values (G1). Without it, every component in the new version is a new type, so React remounts the whole tree. That includes a stable wrapper that calls `Applet()` as a function: only `Applet`'s own hooks survive. Spike 0 measured all three approaches. (000 §4.2)

- **Build:** the protected `vite.config.ts` runs `react-refresh/babel` on applet modules. Components register under IDs of the form "path relative to `work/` + component name", which are the same in every version. Each version builds to a single bundled file.
- **Loader:** injects the Refresh runtime into React's global hook **before React DOM loads**. On activation it imports the version's entry, renders its `Applet`, and calls `performReactRefresh()`.
- **Fresh module instance per activation** (e.g. `main.js?activation=N`). Refresh ignores types it has already seen, and an ES module evaluates only once, so re-activating an already-imported version (e.g. Revert) would otherwise leave the newer code on screen. This is why a version must be a single file: shared chunks would be reused.
- **Development builds of React**, because production React has no hot-reload hooks. Acceptable under N4.
- A component whose hooks changed between versions remounts. That's Refresh's rule, and it's correct.

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