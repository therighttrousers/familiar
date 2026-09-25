# State

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.4, §2.1–2.4, §3.4a, §4.5

## Store

Applet state lives in **Automerge**, synced and persisted with **`automerge-repo`**. Concurrent edits by the user and the runtime agent merge without conflict handling on our part. Performance is not a concern while Familiar runs toy applets. (000 §2.1)

## Documents

Each app has:

- **One state doc per schema version.** Its root *is* `State`. A migration creates a new state doc; old state docs stay intact, with their full history.
- **A control doc**, written **only by the harness**. It holds the **active version** pointer `active: { code: "v{n}", stateDoc: "<id>" }`, and later settings and chat history. **Activating** a version changes code version and state doc together, in one control-doc change.

Post-MVP: an **index doc** listing apps, for multiple apps (see [ux](ux.md#sessions-and-persistence)).

Who can reach what:

- The **harness UI** is an automerge-repo peer of the harness server and syncs the control doc and state docs.
- The **applet iframe syncs only the active state doc**, through the parent page (automerge-repo MessageChannel adapter). It holds no credentials. The parent's repo enforces this with `shareConfig`: `access` grants the iframe's peer only the active state doc, and `announce` announces nothing to it. A request for any other doc comes back "unavailable", even if only the harness server has it. On activation the parent calls `shareConfigChanged()`, which stops the old doc syncing to the iframe. Doc IDs are also unguessable, and the iframe is told only its own. (Checked in Spike 0.)
- The **loader** gets the pointer read-only from the parent via `postMessage`.
- Two channels connect the harness UI and the harness server: an **automerge-repo websocket** for doc sync, and a **JSON websocket** for chat and runtime agent events (streaming text, status, publish results).
- The **runtime agent** never syncs any doc. It reads and writes state through harness RPC tools (see [runtime agent](runtime-agent.md#tools)), and indirectly through the applet code it writes.

**Enforce at the channel; APIs inside the iframe are conveniences.** Code in one JS realm can't be reliably locked down short of Hardened JS (`ses` `lockdown()`), which is heavy and delicate. So the iframe's power is whatever the parent grants over the port. The in-applet `store` needs no lockdown, because the whole doc it can reach *is* its legitimate scope. Future harness APIs for the applet (e.g. `flush()`, "notify the runtime agent") are `postMessage` requests that the parent validates. (000 §1.4)

**Attribution (G8):** state-doc changes arriving through the iframe's connection are "user or applet". Changes the harness applies for the runtime agent's RPC calls are the runtime agent's.

## Data rules

The runtime agent never needs to know Automerge exists, but it must follow these rules:

- State is a **tree, never a DAG**: no shared references (Automerge throws unreadable Rust errors otherwise). No `undefined`.
- State goes in **Automerge** if the runtime agent needs to see or update it, **or** it must survive a refresh/reload. Everything else goes in **React state**. Prefer React state for controlled-component text in progress, unless the runtime agent needs to see it. (000 §2.4)
- Applets don't use browser storage (`localStorage`, IndexedDB, …). Persistent state goes in Automerge.

These rules go in the runtime instructions (see [runtime agent](runtime-agent.md#runtime-instructions)).

Post-MVP: a third kind of state, persisted but hidden from the runtime agent (e.g. navigational state like the current tab).

## In-applet store API

A protected module `@harness/state` exports a Zustand-like **`store`**:

- `store.use(): State`: React hook returning the current state.
- `store.change(draft => { ... })`: an Automerge change function.

It is a thin wrapper over the active state doc's automerge-repo handle. The applet never sees schema versions, heads or the control doc. (000 §4.5)

Post-MVP: selectors, e.g. `store.use(s => s.board)`.

## Schema changes

- The schema is one TypeScript type named `State`, exported from `schema.ts`. Its definition may span multiple files.
- A schema change always implies a code change. A code change does not always imply a schema change; code versions without a schema change share a state doc.
- When `State` changes, the runtime agent writes `migrate.ts`, exporting a synchronous `migrate(prev: PrevState): State`. **The presence of `migrate.ts` signals a schema change.** MVP: `migrate` is not typechecked against `PrevState`.
- `migrate` **runs in the runtime agent container** (see [security](security.md#trust-boundaries)). At publish time, `publish_applet` gets a fresh state snapshot from the harness, runs `migrate`, and sends the result with the new code version. The harness creates the new state doc and activates the new version. Afterwards `migrate.ts` is archived (e.g. `migrations/v{n}.ts`), so it won't run again and stays available for replay. (See [code versions](code-versions.md#publish-pipeline).)
- `migrate` is an optimization: the harness's contract is "new code + new state", and the runtime agent could produce the new state directly.
- An old applet only ever holds the old state doc, so it can never render new-shaped state. The loader switches only once the new state doc is ready (see [code versions](code-versions.md#loader)).
- Rollback activates an earlier version; its state doc is untouched.
- All versions are kept, so history stays easy to access.

Accepted MVP gap: edits made to the old state doc after the migration snapshot are lost. Later we could re-run the migration or replay the edits.

Later: write migrated state as a minimal diff rather than a fresh tree, to keep per-field history and small deltas.

## Applying the runtime agent's patches

The runtime agent writes **JSON Patch** via `patch_state`, against the state it last saw. The user may have changed things since, e.g. shifting array indices.

- **Design:** the harness records the active state doc's heads each time it delivers state to the runtime agent (a change batch or `get_state`). It applies the runtime agent's patches **at those heads** with `DocHandle.changeAt`, and Automerge merges them forward. The runtime agent never sees heads. (000 §3.4a)
- **PoC:** apply patches to the current doc and reject any whose paths don't resolve.
- **String `replace` ops go through `A.updateText`**, in both cases. It diffs old and new strings into splices, so the user's concurrent typing in the same string survives. Plain assignment creates a new string object and discards it.
- A patch to an item the user has deleted since is **silently dropped**, not rejected. Accepted for now.

The harness converts JSON Patch ops into Automerge draft mutations (`add`, `remove`, `replace`; `-` for appending). Spike 0 has a working version (`spikes/spike0/automerge/jsonpatch.ts`).

## Open questions

- **Where the version history lives.** Revert activates "the previous version", but the design doesn't say where the list of versions is recorded. Leaning: in the control doc, next to `active`, e.g. `versions: [{ code, stateDoc, publishedAt, … }]`.
- **Where chat history lives.** Record 000 puts it in the control doc (later) in §1.4, but makes the event log the source of truth for chat history after a restart in §3.7 (see [engineering](engineering.md#event-log-and-observability)). Pick one.
- **Attribution by actor ID** was unreliable in the original project, possibly because the runtime agent ran in the same thread as component listeners. Attribution by connection (G8) may make this moot; watch for it.
