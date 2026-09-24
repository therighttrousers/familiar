# Familiar — Initial design decisions

## Context

Record of the initial design meeting for Familiar.

In a previous job, the project author had created a highly malleable, LLM-backed app, and wanted to recreate it, but make it more capable and secure.

Terminology (runtime agent, app vs. applet, activate, …) was settled after this meeting and applied to this record retroactively. See `docs/designs/high-level-design.md#terminology`.

## 1. Architecture

- [x] **1.1 Process topology** — Which processes/containers exist and what runs where?
  - Decision (MVP): **Docker Compose with `harness` (trusted) and `runtime-agent` (untrusted) services.**
    - The runtime agent is only on an `internal` Docker network, with no internet.
    - The harness proxies the Anthropic API and adds the key, so the runtime agent never holds it.
    - The harness reverse-proxies the runtime agent container's static applet server on a separate port, which gives the iframe its own origin.
  - PoC first: the **harness runs on the host** for fast iteration, while the **runtime agent is containerized from day one** (it runs with permission prompts off). Containerize the harness before the MVP. → 7.4
  - Later egress (e.g. `npm install`): add an **egress proxy service** (e.g. Squid) on both networks with a domain allowlist (`registry.npmjs.org`), and point the runtime agent at it via `HTTPS_PROXY` / npm `registry`. Possibly add a registry mirror (e.g. Verdaccio) to cache or vet packages.
    - Not Vite proxy rules: those govern the *applet's* browser requests (see 5.3), and Vite runs in the untrusted container anyway.
  - MVP: preinstalled package set, no egress. → 4.5

- [x] **1.2 Harness ↔ runtime agent interface** — How does the harness drive the runtime agent and how does the runtime agent act on the world?
  - Decision:
    - A **runner process in the runtime agent container** drives Agent SDK `query()` with streaming input.
    - In-process MCP tools (`get_state`, `patch_state`, `publish_applet`) call a **narrow harness RPC**. The harness performs every Automerge write on the runtime agent's behalf.
    - The runner is **not** an automerge-repo peer.
    - The runner is untrusted: the runtime agent can edit or kill it, so the harness validates everything.
    - Everything arriving through the RPC is attributed to the runtime agent (G1).

- [x] **1.3 Where generated code lives and who builds it** — Shared volume? Git repo in workspace? Who runs Vite/tsc?
  - Decision (by P1): **Vite (`vite build`), tsc and npm all run in the runtime agent container.** The container serves the built versions (`dist/v{n}/`) and the loader to the iframe, from its own origin/port. The harness never touches applet code.
  - Protected from the runtime agent: `vite.config.ts`, the iframe loader (4.1) and `@harness/state`. Vite runs the config as trusted code, and the loader is how the harness recovers without the runtime agent (P2).

- [x] **1.4 Browser ↔ harness transport** — WebSocket, SSE + POST, Automerge sync protocol directly?
  - Decision: **one state doc per schema version + a control doc** ("option C").
    - **State docs:** each schema version's state is its own Automerge doc, whose root *is* `State`. A migration creates a new state doc from `migrate`'s output. Old state docs stay intact, full history included.
    - **Control doc:** holds `active: { code: "v8", stateDoc: "<id>", ... }`, and later settings and chat history. **Only the harness writes it.** The iframe's loader receives the pointer read-only via `postMessage`.
    - The **iframe syncs only the active state doc**, through the parent page (automerge-repo MessageChannel adapter). The iframe holds no credentials. The parent's share policy exposes only that doc; doc IDs are unguessable, and the iframe is told only its own.
  - **Principle: enforce at the channel; in-iframe APIs are conveniences.** Code in the same JS realm can't be reliably locked down short of Hardened JS (`ses` `lockdown()`), which is heavy and delicate. So the iframe's power is whatever the parent grants over the port. The in-iframe store (4.5) needs no lockdown, because the whole doc it can reach *is* its legitimate scope; bypassing the store gains nothing. Future harness APIs (`flush()`, "notify runtime agent") are `postMessage` requests the parent validates.
  - **Two channels**: an automerge-repo websocket for doc sync, and a JSON websocket for chat and runtime agent events (streaming text, status, publish results).
  - Runtime agent access to state: through harness RPC tools (1.2), and indirectly through the code it writes that runs in the iframe. Never direct.
  - G1: state-doc changes arriving through the iframe's connection are "user or applet"; changes arriving through the RPC are the runtime agent's.
  - **Readiness:** Automerge doesn't order writes across docs, and the pointer travels by `postMessage`. So on activation, the loader keeps rendering the old version until automerge-repo reports the new state doc ready (`whenReady()`), then switches. Spike 0 confirms `whenReady()` means "fully synced" for a doc created in one change.
  - Spike 0: can automerge-repo **refuse** a peer's request for a doc ID it wasn't offered, not just avoid announcing it? Believed yes in newer versions (separate announce/access policies); unconfirmed. Unguessable IDs cover most of the risk either way.
  - Superseded:
    - One app doc with `states: {1: …, 2: …}` buffers and a heads-based readiness gate.
    - A `postMessage` snapshot/JSON Patch bridge with no Automerge in the iframe. It needed an optimistic-rebase sync adapter.

- [x] **1.5 Scale-out / productization stress test** — Not a plan to scale. We check that no decision *prevents* a second deployment context: cloud, multi-tenant, many sessions. Two contexts expose bad assumptions even if we never ship.
  - Imagined cloud shape:
    - Per-session runtime agent sandbox (microVM / gVisor-class isolation; Docker alone is too weak for multi-tenant untrusted code), scaled to zero when idle.
    - Harness tier with sticky per-session routing.
    - Automerge storage in a database or object store.
    - The build still happens in the sandbox (`vite build` is fine), but published bundles are **immutable static artifacts** served from object storage/CDN on a per-session origin. No Vite dev server.
  - Decision — cheap changes now:
    - **A. Opaque code version IDs.** The pointer holds a version ID, not a directory name. The loader asks a resolver for "version ID → entry URL". Dev maps IDs to `dist/v{n}/` in the container; cloud maps them to bundle URLs. With immutable builds (4.1), dev and cloud now share the same shape.
    - ~~**B. Applet serving is independent of runtime agent liveness.**~~ **Rejected.** The app requires the runtime agent; its presence is the product (see Vision). In the cloud, a session's runtime agent stays warm while the user is active, and everything sleeps together when they leave. Accepted consequence: in dev, the applet is briefly unavailable while the runtime agent container restarts (C).
    - **C. Disposable runtime agent container.** Durable things (`work/` + git, Claude Code session transcripts under `~/.claude`) live on a volume. The harness can recreate the container and resume the SDK session. (6.5)
    - **D. Harness state is per-session objects keyed by session ID**: batch timers, delivered heads (3.4a), queues, the runner connection. No process-global singletons.
    - **E. The iframe holds no credentials.** It syncs the active state doc through the parent (automerge-repo MessageChannel adapter). The parent's share policy exposes only that doc. (1.4)
    - **F. Applets don't use browser storage.** Persistent state goes in Automerge. Cloud gives each session its own origin anyway. (8.4)
    - **G. Correctness must not depend on Vite HMR/Fast Refresh.** Satisfied by construction: immutable builds (4.1) don't use either.
  - Holds up as is: Automerge + automerge-repo, P1/P2, harness-mediated RPC, chat in the harness UI, the readiness gate, JSON Patch deltas, G1 (per-connection attribution extends to multiple users).
  - Productization-only (not blocking): auth and tenancy, per-user keys/metering (8.3), sandbox runtime choice, egress policy as network policy.

## 2. Applet state

- [x] **2.1 State store** — Automerge vs. alternatives (Yjs, plain JSON + JSON Patch, SQLite).
  - Decision: **Automerge + `automerge-repo`** (sync + storage).
  - Rationale: concurrent user/runtime agent edits just work (proven in the original project); automerge-repo solves sync and persistence. Performance is not a concern while we're demoing toys.
  - The runtime agent never needs to know Automerge exists, but it must follow data rules, e.g. **state is a tree, never a DAG** (no shared references, or Automerge throws unreadable Rust errors). → 8.4
  - Watch: attribution via actor IDs was unreliable in the original project (possibly because the runtime agent ran in the same thread as component listeners). Check again here, since the runtime agent is now a separate process. → 6.4

- [x] **2.2 Single doc vs. many docs** — One document per app/session, or per feature/module?
  - Decision (settled by 1.4): per app, **one state doc per schema version** + a **control doc** (pointer, later settings and chat). Post-MVP: an **index doc** for multiple apps (6.5).

- [x] **2.3 Schema evolution** — When the runtime agent changes state shape, how do we migrate?
  - Decision: the approach below. `migrate` **runs in the runtime agent container**. A schema change is **detected by the presence of `migrate.ts`**.
  - Framing: the harness's contract is "new code + new state". `migrate` is an *optimization* of the runtime agent producing the migrated state itself. The runtime agent could also emit the state directly.
  - Sketch: the in-container `publish_applet` tool gets a fresh snapshot from the harness at publish time, runs `migrate`, and sends the code version + new state to the harness. The harness creates the new state doc, then activates the new version. Afterwards `migrate.ts` is archived (e.g. `migrations/v{n}.ts`), so it won't re-trigger and remains available for replay later.
  - Details (carried over from the original project):
    - The schema is one TS type named `State`, exported from `schema.ts`. Its definition may span multiple files.
    - A schema change always implies a code change; a code change does not always imply a schema change.
    - If `State` changes, the runtime agent must write `migrate.ts` exporting a synchronous `migrate(prev: PrevState): State`. MVP: no typechecking of `migrate` against `PrevState`.
  - New problem: the original swapped code and state synchronously, so the old applet never rendered new state. We can't do that across processes.
  - Mechanism: **one state doc per schema version** (1.4).
    - Each code version is bound to a state doc by the pointer. An old applet only ever holds the old doc, so it can never render new-shaped state.
    - Upgrade: (1) run `migrate` on the old state → create the new state doc; (2) activate the new version (`{ code, stateDoc }`); (3) the loader switches once the new doc is ready.
    - Rollback: reactivate the earlier version; its state doc is untouched.
    - Keep all versions for now: history should stay easy to access.
  - Accepted MVP gap: edits made to the old state doc after the migration snapshot are lost. Later we could re-run the migration or replay the edits.
  - Later: write the migrated state as a minimal diff rather than a fresh tree, to keep per-field history and small deltas.

- [x] **2.4 Ephemeral vs. persistent state** — Is UI state (selection, scroll, focus, open menus) in the store, in React, or split? What survives a code swap?
  - Decision: state goes in **Automerge** if the runtime agent needs to see or update it, **or** it must survive a refresh/reload. Everything else goes in **React state**.
  - Needs careful prompting. → 8.4
  - Post-MVP: a third kind, persisted but hidden from the runtime agent (e.g. navigational state like the current tab).

## 3. Runtime agent observation & action

- [x] **3.1 What the runtime agent sees** — Delta representation (Automerge patches, JSON Patch, prose summary, before/after snippets). Include a UI event log ("user clicked e2→e4") or only state?
  - Decision: **an array of JSON Patches**, converted from Automerge patches out of the box. State only, no UI event log. Refine once we see how it fails. Automerge patches aren't always small or comprehensible to the runtime agent; the original project wrapped a JSON diff algorithm instead.
  - Changes the harness applied for the runtime agent are excluded, identified by recording doc heads around each runtime agent write (G1).

- [x] **3.2 Filtering / subscription** — How does the runtime agent declare which state changes it cares about? Who decides what is "interesting"?
  - Decision: **no filtering to start.** The runtime agent filters *by design* when it chooses React state over Automerge state (2.4). Tell it to prefer React state for controlled-component text in progress. Good use of React state plus batching (3.3) may be all we need.

- [x] **3.3 Batching & debouncing policy** — Time window, flush on idle, flush on explicit user action?
  - Decision: flush after **1.5 s idle**, or **5 s** at most since the first unsent change. Chat messages **flush immediately**, with pending changes delivered first.
  - Keep these values configurable. The original used a fixed 500 ms window, with the timer starting at the first change after the last send. Revisit if the user and runtime agent use the applet concurrently.
  - How the chat flush works depends on where chat lives. → 6.7

- [x] **3.4 Runtime agent's action vocabulary** — Tool set: `get_state`, `patch_state`, `publish_applet`, `say` (chat), anything else? Can the runtime agent run code *in the applet* (e.g. call applet functions) vs. only patch state?
  - Two ways to write state:
    - (a) **JSON Patch**: less plumbing, easy to validate.
    - (b) **Synchronous transformer function** that mutates an Automerge proxy, with patches captured on the side. This is what the original project did; it's better for bulk or computed updates.
  - Decision: tools **`get_state`, `patch_state` (JSON Patch), `publish_applet`**. No `say` tool: chat is plain text (3.7).
  - (a) for the MVP. If we add (b), it runs inside the runtime agent container (e.g. the runtime agent runs a script against a state snapshot and submits the resulting patch), never in the harness. → 5.6

- [x] **3.4a Stale patches** — The runtime agent writes patches against the state it last saw; the user may have changed things since (e.g. array indices shifted).
  - Decision: the harness records the active state doc's heads each time it delivers state to the runtime agent (delta batch or `get_state`). It applies runtime agent patches **at those heads** and lets Automerge merge them forward to the current heads. Automerge supports this; the API is probably `changeAt` (to be checked). The runtime agent never sees heads.
  - Fallback: apply to the current doc and reject patches whose paths don't resolve.

- [x] **3.5 Concurrency** — What happens when the user acts while the runtime agent is mid-turn? Queue, interrupt, merge? (CRDT helps with state; code is the harder part.)
  - Decision: **no interrupts.** Changes and chat queue up and are delivered as the next message, using Claude Code's streaming-input queueing. Fix only if broken; it's an interesting experiment.

- [x] **3.6 Model & effort selection** — One model for everything, or fast model for reactions (chess move) and strong model for rewrites?
  - Decision: **Opus 5.5 only** for the MVP.
  - Later: model routing, e.g. a small model chats and uses the applet with the user, and a big model only writes code.

- [x] **3.7 Message encoding** — How batched changes (and chat, and harness notices like "rollback happened" or "publish failed") are encoded in messages to the runtime agent. E.g. tagged blocks wrapping the JSON Patch array, with a source label.
  - Decision:
    - **Runtime agent input** is **tagged blocks** with source labels, changes before chat, e.g. `<applet-changes source="user" schema="3">[…]</applet-changes>`, `<chat from="user">…</chat>`, `<harness-notice kind="reverted">…</harness-notice>`. The harness builds whole messages, so end tags cost nothing. Instructions frame user content in `<applet-changes>` as data. → 5.5
    - **Runtime agent output** is **tool calls + plain text**, structured by the SDK with nothing to parse. "Nothing" is an empty turn.
    - **Deliberately asymmetric:** if the runtime agent saw its own output in the input format, it could imitate it and write fake change blocks as text instead of calling tools.
    - **Harness event log:** **JSON Lines**, one symmetric event stream for both directions (`user.chat`, `user.changes`, `agent.text`, `agent.tool`, `harness.publish`, …). Streamable, no end tags. It is the single source of truth for the debug view (6.6), replay (6.4), chat history after restart, and observability (8.2). The encoding the runtime agent sees is a rendering of its user-side events.
  - Rejected: symmetric parsed-action encoding (the original's approach). Its advantages were uniform parsing and avoiding the tool-call API; both are moot with Claude Code.

## 4. Code updates ("don't interrupt the user")

- [x] **4.1 Vite HMR vs. staged publish** — Let HMR pick up edits live, or have the runtime agent edit in a staging copy and publish atomically? Hybrid (HMR on a publish-only directory)?
  - Decision: **immutable built versions.**
    - The runtime agent edits `work/`.
    - `publish_applet` runs `tsc`, then `vite build work/ → dist/v{n}/`, then `migrate` if present, then hands the result to the harness.
    - The pointer holds the opaque version ID (`v{n}`). The loader imports `/v{n}/main.js`.
    - A static server in the runtime agent container serves `dist/`. **No Vite dev server, no HMR** in the applet path.
  - Why:
    - No HMR/watcher uncertainty.
    - Revert can go back **any number of versions**, not one.
    - Dev matches the cloud shape (1.5 A).
    - A toy-applet build takes a second or two, negligible next to a runtime agent turn.
  - Cost: the loader and all versions must share **one React** (and `@harness/state`), or hooks break. Use an **import map** in the loader page mapping `react`, `react-dom` and `@harness/state` to single shared copies, with applet builds marking them external.
  - The pointer lives in harness-only data, e.g. `active: { code: "v8", stateDoc: "<id>", ... }` in the control doc (1.4). One change activates code and state doc together. The harness rolls back by writing the pointer, with no help from the container (P2). A small protected loader in the iframe follows the pointer.
  - Atomicity / readiness: the loader switches only once the new state doc is ready (1.4).
  - Each version declares which schema version it reads. Code changes without a schema change share state.
  - Remounting on activation: see 4.2.
  - Post-MVP: a richer loader (e.g. an error boundary that notifies the runtime agent and triggers rollback).
  - Superseded: double-buffered `a/`/`b/` directories served by the Vite dev server, copied late from `work/`. This carried the HMR-reload risk, the static-vs-dynamic import question, and one-level rollback. The "single `live/` directory + Fast Refresh" fallback is gone with it.

- [~] **4.2 React state preservation** — Rely on React Fast Refresh? What breaks it (component signature changes, non-component exports), and does it matter if meaningful state is in the store?
  - Concern: `v7/Applet` and `v8/Applet` are different component types, so React will likely **remount** the whole tree on activation. That loses React state and recreates the DOM (focus, half-typed input, scroll, selection).
  - Confirmed: the original's eval component preserved uncontrolled state by keeping a stable wrapper type.
  - Spike: activate versions under a live page with an input mid-edit and a scrolled list.
  - Decision: **spike first; no tricky workarounds unless the spike says we need them.** If remounting is disruptive, the known fix is the original project's approach: a stable wrapper component type rendering the loaded code.

- [x] **4.3 Validation gate** — Typecheck / build / smoke-render before swap? Tests?
  - Decision: `publish_applet` runs `tsc --noEmit` on `work/`, then `vite build`, then `migrate` if `migrate.ts` exists. On any failure: nothing is activated, and the errors return to the runtime agent as the tool result. No tests or smoke renders in the MVP.

- [x] **4.4 Failure & rollback** — Error boundary → revert to last good version → report error to runtime agent. Git as version history? Tie code versions to state versions?
  - Decision: **manual "Revert" button in the harness UI** (outside the iframe). It reactivates the previous version (code + state doc), then notifies the runtime agent so it doesn't build on the rejected version. Immutable versions (4.1) allow reverting repeatedly.
  - `work/` keeps the rejected code. It's committed to git on each publish, so the runtime agent can restore earlier versions.
  - Post-MVP: automatic rollback from a loader error boundary (4.1).

- [x] **4.5 Applet framework conventions** — What the runtime agent is told about structure: entry point, how to read/write state (hooks), component library (none? shadcn? Tailwind?), allowed npm deps and how they get installed.
  - Decision:
    - **Entry point:** `main.tsx` default-exports `Applet`, and nothing else. The loader owns the React root and renders `<Applet />` (the site of the 4.2 stable-wrapper fix, if needed).
    - **State API:** a protected module `@harness/state` exporting a **Zustand-like `store`** (as in the original multi-user prototype): `store.use(): State` (React hook) and `store.change(draft => ...)` (Automerge change function). A thin wrapper over the active state doc's automerge-repo handle; the doc root *is* `State`, so no scoping is needed. The applet never sees schema versions, heads, or the control doc. A convenience, not a security boundary (1.4). Automerge data rules go in the runtime agent's instructions (8.4).
    - **Styling:** Tailwind v4 (Vite plugin in the protected config).
    - **Components:** **shadcn/ui**, generated into `work/components/ui/` at bootstrap. Its dependencies (Radix, `lucide-react`) are preinstalled.
      - The original project found a component library cheap and valuable: good demos, and it rules out whole classes of issues.
      - MUI was too heavy (slow even under Vite). shadcn is light, Tailwind-native, lives as source the runtime agent can modify, and models are fluent in it.
    - **Preinstalled packages:** React, React DOM, Tailwind, shadcn deps, `@harness/state`. **No domain libraries** (e.g. no `chess.js`): the runtime agent builds the smarts itself.
  - Post-MVP: selectors, e.g. `store.use(s => s.board)`. The original had them, but selector hooks were fiddly. Worth it if applets grow.

## 5. Security & sandboxing

- [x] **5.1 Runtime agent container hardening** — Non-root, mounts, resource limits, egress allowlist (Anthropic API, npm registry?).
  - Decision:
    - Non-root user, `--cap-drop ALL`, `no-new-privileges`.
    - Memory, CPU and process-count limits.
    - Never mount the Docker socket.
    - **Protected files** (`vite.config.ts`, the loader, `@harness/state`) are root-owned and read-only to the runtime agent user. A real barrier, unlike the 5.7 hook.
    - Writable: `work/`, `dist/`, `~/.claude`, Vite cache.
    - Egress per 1.1.
  - Later: read-only root filesystem.

- [x] **5.2 API key handling** — Key in container env vs. injecting proxy (`ANTHROPIC_BASE_URL`).
  - Decision: PoC: key in the container env (accepted gap). MVP: key-injecting proxy in the harness (1.1, 7.4).

- [x] **5.3 Generated-applet sandbox** — Separate origin + sandboxed iframe + postMessage bridge? CSP? Network access for the applet?
  - Decision:
    - `sandbox="allow-scripts allow-same-origin allow-forms"`. Safe **only because** the applet origin (separate port) differs from the harness origin. Must stay that way.
    - CSP `connect-src 'self'`: **no network access for applets** in the MVP. The applet talks only to its own static server and to the parent via `postMessage` (1.4).
  - Post-MVP: applet network access through a harness-controlled proxy, with an allowlist the user manages in harness settings.

- [x] **5.4 Permission mode inside container** — Skip permissions entirely, or keep hooks/guardrails (e.g. block edits outside `work/`)?
  - Decision: `bypassPermissions`, plus the `PreToolUse` guardrail from 5.7.

- [x] **5.5 Prompt injection surface** — User-entered state flows into the runtime agent's context. Anything to do in the MVP?
  - Decision (MVP): **deferred.**
    - Single user: the only injector is the user.
    - Nowhere to exfiltrate to: no network, and no key in the MVP.
    - In place already: user content framed as data (3.7) and chat as the trusted channel (6.7).
  - Revisit when any of these land: applet network access, multi-user, npm egress. Include the question of whether chat is more authoritative than in-applet text (6.6).

- [x] **5.6 Where code written by the runtime agent executes** — Applet code, `migrate`, and state transformers are all written by the runtime agent.
  - Decision: **code written by the runtime agent runs only in the runtime agent container or the sandboxed applet iframe, never in the harness process.**
  - `migrate` and state transformers run in the container: one migrator, no multi-tab race.

- [x] **5.7 Enforcing "the runtime agent writes only `work/`"** — The runtime agent shares a filesystem and user with `dist/`, git history and the runner. It could write into `dist/` directly and skip typechecking and migration.
  - Threat is mostly mistakes, or a prompt-injected runtime agent. Either way, the damage stays inside the container and the sandboxed iframe (P1).
  - Decision (MVP): convention (CLAUDE.md) + a Claude Code `PreToolUse` hook that blocks Edit/Write outside `work/`. A guardrail, not a wall: Bash can get around it.
  - Later (real enforcement):
    - Split serving into a separate **`serve` container** (builds and serves `dist/`, runs tsc/migrate on publish) that mounts `work/` read-only. The runtime agent container mounts only `work/`.
    - The harness keeps copies of published trees (data, not execution, so P1 allows it). Full recovery = recreate containers from images + restore from those copies (P2).

## 6. User experience

- [x] **6.1 Layout** — Chat panel + applet side by side? Chat collapses as the app grows? Chat becomes part of the applet?
  - Decision (as in the original):
    - **The applet always exists.** The bootstrap applet is a near-blank canvas with a short, friendly, centered label saying what to do. It is published as `dist/v0/` at bootstrap (8.1). Also simplifies logic and serves as a one-shot example for the runtime agent.
    - **One layout throughout:** the chat pane starts open, on the right or bottom depending on screen dimensions, and is collapsible.
    - **Harness toolbar under the chat input:** a hamburger menu on the left, controls in the middle (later: microphone, headphones), Send on the right. Revert goes here or in the hamburger menu.
  - From the original: a **collapsible chat pane** plus voice chat made chat feel woven into the app. The runtime agent role-played *as the app*, so it felt like talking to the app itself.
  - Given: there is a **harness UI** (called the "host UI" in the original) outside the applet iframe. It holds chat, Revert, and later credentials, cross-app settings and feature toggles. It is trusted and can't be modified by the runtime agent.

- [x] **6.2 Runtime agent activity feedback** — How does the user know the runtime agent is thinking/rewriting? Progress indicator, streaming narration, diff preview?
  - Decision:
    - **Streaming** runtime agent text in chat.
    - **Progress bar above the message history**, with status text over it (e.g. from the SDK's tool-call stream: "Editing Grid.tsx"). Animation: **solid** while the runtime agent is working, **dots** while the harness is holding a batch of state changes for the user to finish (3.3).
    - **New:** an "App updated" notice after each publish, with Revert.
  - Post-MVP: diffs and previews.

- [x] **6.3 Consent for rewrites** — Does the runtime agent rewrite freely, or propose and wait for approval? Per-change or trust setting?
  - Decision: **rewrite freely**, with Revert as the safety net. The runtime instructions give guidance on choosing between upgrading the applet, changing state, chatting, or doing nothing. Even older models followed such guidance well. → 8.4
  - Post-MVP: ask before "big" changes, likely defined as changes that would interrupt the user's flow. Leave the judgment to the runtime agent.

- [x] **6.4 Undo / history** — Can the user undo a rewrite? Undo a state change made by the runtime agent? Browse versions?
  - Decision: **Revert only** (as in the original). Revert restoring the old state doc is acceptable: reverts are usually triggered by a type error or an immediate runtime error.
  - Post-MVP: undo/redo built mostly on Automerge history + git + G1 attribution. The main use case is demos: **deterministically replaying runtime agent actions**. The original's hand-rolled undo was rarely used otherwise. → 8.2

- [x] **6.5 Sessions & persistence** — Multiple apps/sessions? Resume after restart (runtime agent session + state + code)? Fork an app?
  - Decision:
    - **MVP:** one app at a time, surviving restarts (1.5 C).
    - **PoC:** starts from scratch. To test from partway through a scenario, build an alternative initial applet and state.
  - Post-MVP: multiple apps via an index Automerge doc. Just work, nothing hard.

- [x] **6.6 Implicit vs. explicit communication** — When should the runtime agent react to state changes unprompted vs. only to chat? How does the user signal "that was for you"?
  - Decision:
    - The runtime agent gets the **same response options for every input** (a change batch, a chat message, or both): **chat, act (change state), update the applet, or nothing.**
    - "Nothing" is valid even for chat. E.g. thinking out loud over voice: be heard, but don't be answered until done.
    - **Start by telling the runtime agent only its options, without detailed guidelines**, and see whether current models need more. → 8.4
    - Replies to user changes are usually state changes or nothing, but the app can talk, **in its own voice** (role-play as the app).
  - Harness UI: by default shows chat plus abbreviated action indicators. **Debug view** shows every message, including "nothing" turns, tool calls, and code.
  - Observed in the original: text typed into applet text boxes addressed to the runtime agent ("Can you fill in this text for me?") was treated like chat and worked well.
  - Post-MVP: should chat be *more authoritative* than in-applet text? → 5.5

- [x] **6.7 Where chat lives** — In the harness UI, or in the malleable app?
  - Decision: **harness UI.** Also keeps future features like voice chat out of the runtime-agent-written applet.
  - If it's in the applet, the runtime-agent-written code needs a harness-provided `flush()` (3.3) and can impersonate the user.
  - The original project kept it in the harness UI.
  - Rationale:
    - Chat is the recovery lifeline and must work when the applet is broken (P2).
    - It's the one channel where "the user said this" is certain, which matters for prompt injection (5.5) and attribution (G1).
    - The flush is internal to the harness.
  - The applet can still show conversational elements through state (e.g. chess trash talk).
  - Post-MVP: expose `flush()` to the applet via the loader (e.g. a "Submit move" button).

## 7. MVP scope

- [x] **7.1 Target demos**
  - Decision:
    - **PoC 1: live translation.** The initial applet is side-by-side multiline inputs labeled English and Spanish. The runtime agent is instructed to update the opposite side as the user types. Exercises the **observe → act loop** (change batches → `patch_state`) and runtime agent presence, with no code changes.
    - **PoC 2: spreadsheet.** "I need a spreadsheet" → grid → user types `=A1+1` → the runtime agent sees the change → adds a formula engine → the cell shows a number. Exercises the **rewrite loop**: chat → publish, change batches → publish, and **migration** (the first real applet migrates away from the bootstrap applet's `State`; the formula engine may migrate again).
    - **MVP: + chess.** Exercises the runtime agent *acting* via `patch_state` in response to user moves, and the runtime agent staying present. Stretch: one "intelligence inside the applet" demo from the Vision (e.g. shopping-list allergens or interactive fiction).

- [x] **7.2 In / out list**
  - Decision — **Spike 0** (before PoC 2; throwaway code):
    - Loader switches between two built versions as each is activated (`dist/v1/`, `dist/v2/`) with an input mid-edit and a scrolled list. Does it remount? Import map sharing one React across versions. (4.1, 4.2)
    - Automerge sanity checks: `changeAt` at old heads, patch → JSON Patch conversion, `whenReady()` on a newly created doc, and whether automerge-repo can refuse a peer's request for an unoffered doc ID. (1.4, 3.4a)
  - **PoC 1: translation** (in):
    - Runtime agent container (normal network, key in env, non-root), serving the fixed initial applet as a static build (`vite build` once, static server).
    - Runner with Agent SDK streaming input. Tools: `get_state`, `patch_state`.
    - Harness on host: automerge-repo, **a single state doc** (no control doc), iframe sync through the parent, batching (1.5 s / 5 s / chat flush), message encoding, excluding the runtime agent's own changes from batches (G1), JSON Lines log, per-session objects.
    - Harness UI: chat pane (streaming), toolbar with Send, basic status, iframe on a separate origin.
    - `applet-runtime`: trivial loader (renders the one applet), `@harness/state`.
    - Initial applet (hand-written): the translation UI and its `State`. Tailwind + shadcn preinstalled.
    - First-draft CLAUDE.md, plus scenario instructions.
    - Stale patches: apply at the current doc and reject bad paths (the 3.4a fallback).
    - Text deltas: convert Automerge text splices to whole-string `replace` ops. Refine later.
    - Starts from scratch each run.
    - Out: publish, migrate, `tsc` gate, multiple versions, control doc, readiness wait.
  - **PoC 2: spreadsheet** (adds):
    - Control doc + pointer; `work/` → `dist/v{n}/` publish (`vite build`); `tsc` gate; `migrate.ts` run in container and archived; commit `work/` on each publish; state doc per schema version; readiness wait; real loader with import map (per Spike 0). Tool: `publish_applet`.
    - Bootstrap applet becomes the near-blank canvas (6.1).
  - **MVP** (adds):
    - Containerized harness, internal network, key-injecting proxy, applet server reverse-proxied through the harness (1.1).
    - Full hardening (5.1), `PreToolUse` hook (5.7), iframe `sandbox` attribute + CSP (5.3).
    - Collapsible, responsive chat pane; hamburger menu (6.1).
    - Persistence and resume across restarts: volume, SDK session resume, harness storage (6.5, 1.5 C).
    - Revert button, "App updated" notice, solid/dots progress bar (6.2, 6.4).
    - Debug view of all events (6.6). Cost counter (8.3).
    - `changeAt` for stale patches (3.4a).
    - Chess demo.
  - **Post-MVP** (out): everything marked post-MVP/later above, e.g. voice chat, selectors, error-boundary auto-rollback, diffs/previews, undo/replay, multiple apps, npm egress, applet network access, model routing, serve-container split, "ask before big changes".

- [x] **7.3 Single user, local only?**
  - Decision: **yes.** One user, one browser tab, localhost. Multi-user and multi-tab stay *possible* (G1, 1.5) but untested.

- [x] **7.4 Milestones**
  - Decision: **Spike 0 → PoC 1 (translation) → PoC 2 (spreadsheet) → MVP** (contents in 7.2). Spike 0 and PoC 1 are independent and can happen in either order.
    - **PoCs**: harness on the host, runtime agent in a container on a normal network. API key in the container env is an accepted, known gap. The browser hits the container's applet server directly.
    - **MVP**: containerized harness, internal network, key-injecting proxy, reverse-proxied applet server, persistence, chess.

## 8. Other

- [x] **8.1 Repo layout & tooling** — Monorepo structure, package manager (pnpm/npm), lint/format, test framework.
  - Decision: **pnpm workspace**:

    | Package | Contents | Runs in |
    |---|---|---|
    | `protocol` | shared types for the RPC and event log | everywhere |
    | `harness` | server, automerge-repo, event log, key proxy | host (PoC), container (MVP) |
    | `harness-ui` | chat, toolbar, iframe host (trusted; Vite fine) | browser |
    | `runner` | Agent SDK driver + MCP tools | runtime agent container |
    | `applet-runtime` | loader + `@harness/state` (copied in read-only) | iframe |
    | `bootstrap-applet` | blank-canvas starting applet | runtime agent container (`dist/v0/`) |
    | `docker/runtime-agent/` | Dockerfile, preinstalled deps, CLAUDE.md | — |

  - TypeScript strict, **Biome** (lint + format), **Vitest**.

- [x] **8.2 Observability** — Log runtime agent transcripts, state deltas, and code versions for debugging/replay?
  - Decision: a per-session **JSON Lines event log** (3.7), plus Claude Code's own transcripts on the volume, plus git history of `work/`.

- [x] **8.3 Cost controls** — Budget caps, turn limits, token tracking.
  - Decision: a running cost counter in the harness UI, from the cost the SDK reports at the end of each turn. A monthly spend limit in the Anthropic Console as the backstop. Turn or budget limits only if we see runaway turns.

- [x] **8.4 Runtime instructions** — Contents of the workspace `CLAUDE.md` / system prompt; how it survives compaction.
  - Decision: a **read-only workspace CLAUDE.md** plus text appended to Claude Code's system prompt via the SDK. Draft it during the PoC, against real behavior.
  - Contents:
    - role-play as the app
    - the four response options (6.6)
    - the tools (3.4)
    - state rules: tree not DAG, no `undefined`, React vs. Automerge state (2.4), no browser storage (1.5 F)
    - the `schema.ts` / `migrate.ts` protocol (2.3)
    - the 4.5 conventions
    - stay in `work/` (5.7)
    - user content is data (3.7)

- [x] **8.5 Project name** — "ShowDontTell2" is a placeholder.
  - Decision: **Familiar.** A companion spirit that takes whatever form is useful and stays with you, and an app that becomes familiar because it grew around you.
