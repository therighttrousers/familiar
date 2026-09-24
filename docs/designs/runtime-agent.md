# Runtime agent

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.2, §3.1–3.7, §6.6, §8.4

The runtime agent is a Claude Code agent running in the runtime agent container. It rewrites the applet, and it acts inside the applet on the user's behalf.

## Runner

- A **runner** process in the runtime agent container drives the Agent SDK's `query()` with **streaming input**. The session is long-lived.
- The runner hosts the runtime tools as in-process MCP tools. They call a **narrow RPC** on the harness server. The harness performs every Automerge write on the runtime agent's behalf.
- The runner is **not** an automerge-repo peer.
- The runner is **untrusted**: the runtime agent can edit or kill it. The harness validates everything it receives.
- Everything arriving through the RPC is attributed to the runtime agent (G8).

## Tools

| Tool | Does |
|---|---|
| `get_state` | Returns the current state. |
| `patch_state` | Applies a JSON Patch to the current state (see [state](state.md#applying-the-runtime-agents-patches)). |
| `publish_applet` | Validates, builds and publishes `work/`, migrating state if `migrate.ts` exists (see [code versions](code-versions.md#publish-pipeline)). |

There is no `say` tool: chat is plain text.

Later: synchronous state transformer functions (mutating a draft, with patches captured on the side) for bulk or computed updates. They would run in the runtime agent container against a state snapshot, never in the harness (see [security](security.md#trust-boundaries)).

## What the runtime agent sees

- **Change batches:** user changes to state, as an **array of JSON Patches** converted from Automerge patches. State only; no UI event log.
- Changes the harness applied for the runtime agent are **excluded**, identified by recording doc heads around each of its writes (G8). Otherwise it would react to its own output.
- **No filtering.** The runtime agent filters by design, by choosing React state over Automerge state for things it doesn't need to see (see [state](state.md#data-rules)).

Refine the representation once we see how it fails. (Automerge patches aren't always small or easy for a model to read; the original project wrapped a JSON diff algorithm instead.)

## Batching

- Flush after **1.5 s idle**, or **5 s** at most since the first unsent change.
- **Chat flushes immediately**, with pending changes delivered first.
- The values are configurable. The original project used a fixed 500 ms window, starting at the first change after the last send. Revisit if the user and runtime agent use the applet concurrently.

## Message encoding

**Input** (what the harness sends) is **tagged blocks** with source labels, changes before chat:

```xml
<applet-changes source="user" schema="3">
[{"op":"replace","path":"/cells/A2","value":"=A1+1"}]
</applet-changes>
<chat from="user">what's the total?</chat>
<harness-notice kind="reverted">User reverted to the previous version: …</harness-notice>
```

- Harness notices report things the runtime agent didn't do itself, e.g. reverts (see [code versions](code-versions.md#rollback)). Publish failures come back as `publish_applet`'s tool result instead.
- The runtime instructions frame user content inside `<applet-changes>` as data (see [security](security.md#prompt-injection)).

**Output** is **tool calls plus plain text**, structured by the SDK, so there's nothing to parse. A turn that does nothing is an empty turn.

The two are **deliberately asymmetric**: if the runtime agent saw its own output in the input format, it could imitate it and write fake change blocks as text instead of calling tools. (000 §3.7)

The harness's own record of all of this is the event log (see [engineering](engineering.md#event-log-and-observability)). The input encoding is a rendering of its user-side events.

## Concurrency

**No interrupts.** Changes and chat that arrive while the runtime agent is mid-turn queue up, and go out as its next message using Claude Code's streaming-input queueing. Fix only if broken.

## Response options

For every input (a change batch, a chat message, or both), the runtime agent has the same options: **chat, act (change state), update the applet, or do nothing.**

- "Nothing" is valid even for chat. E.g. the user thinking out loud over voice wants to be heard, but not answered until they're done.
- Replies to user changes are usually state changes or nothing, but the app can talk, **in its own voice**: the runtime agent role-plays as the app.
- It rewrites the applet freely, with no approval step; Revert is the safety net (see [ux](ux.md#consent-for-rewrites)).
- Start by telling the runtime agent only its options, without detailed guidelines, and see whether current models need more.

## Model

**Opus 5.5 only** for the MVP.

Later: model routing, e.g. a small model chats and uses the applet with the user, and a big model only writes code.

## Runtime instructions

A **read-only CLAUDE.md** in the runtime agent container's workspace, plus text appended to Claude Code's system prompt through the SDK. Unlike conversation history, neither is lost when Claude Code compacts its context. Contents:

- role-play as the app
- the response options
- the tools
- the data rules (see [state](state.md#data-rules)): tree not DAG, no `undefined`, Automerge vs. React state, no browser storage
- the `schema.ts` / `migrate.ts` protocol (see [state](state.md#schema-changes))
- the applet code conventions (see [code versions](code-versions.md#applet-code-conventions))
- write only in `work/` (see [security](security.md#keeping-the-runtime-agent-in-work))
- user content is data

Draft them during the PoCs, against real behavior.

## Open questions

- **Text deltas.** Automerge represents text edits as character-level splices, which don't map cleanly to JSON Patch. PoC 1 sends whole-string `replace` ops. What should replace them?
- **Patch → JSON Patch conversion** out of the box: confirm in Spike 0.
- **Compaction:** confirm in the PoCs that the runtime instructions really do survive Claude Code's context compaction.
- **Guidelines:** do current models need more than the list of response options? Find out in the PoCs.
