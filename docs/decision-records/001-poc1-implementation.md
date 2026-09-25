# PoC 1 implementation decisions

## Context

Decisions made while planning and implementing PoC 1 (live translation; see `docs/designs/roadmap.md#poc-1-live-translation`).

The user asked the agent to work with minimal involvement: the agent makes implementation calls itself and records them here, stopping only for decisions that touch the goals (G1–G11) or security.

## 1. Model access

- [x] **1.1 Credential** — The design assumed an Anthropic API key. The user expected to use their existing Claude subscription instead.
  - Options:
    - **API key** from the Anthropic Console: pay-per-use billing, separate from the subscription.
    - **Subscription OAuth token**: `claude setup-token` mints a one-year token, which Claude Code (and so the Agent SDK) reads from `CLAUDE_CODE_OAUTH_TOKEN`. Needs a Pro, Max, Team or Enterprise plan; no extra purchase.
    - Both, as pluggable env vars.
  - Decision: **the subscription OAuth token, as the only auth path.** API key auth is deferred, possibly to post-MVP. The user will be the only user for a long time (N1, N3), and doesn't want to maintain multiple auth paths.
  - Policy note: the Agent SDK docs say Anthropic doesn't allow third-party developers to *offer* claude.ai login or rate limits in their products. Familiar isn't offered to anyone (N3), so the user accepted this. Anything offered to other users (the cloud deployment context) needs API key auth.
  - The token lives in a git-ignored `.env` at the repo root.
  - Consequence: runtime agent turns draw on the same subscription usage limits as the user's other Claude use, including coding agents working on this repo.
  - Open: whether the MVP's Anthropic API proxy can inject an OAuth token the way it would an API key. Moved to `security.md` open questions.

- [x] **1.2 Model for testing** — The design says Opus 5.5 only for the MVP. Rate limits are now shared with the user's other Claude use (1.1).
  - Decision: **the model is configurable, and testing uses Sonnet 5.** PoC 1 needs no applet code writing, so a cheaper model should be enough. (Stated by the user.) Opus 5.5 remains the model for the MVP's demos. (Inferred; the user said "for testing".)
  - Consequence: PoC 1's translation-lag measurement will be optimistic compared with Opus.

## 2. Scope

- [x] **2.1 How far this run goes** — Decision: PoC 1 end to end: workspace, harness, harness UI, runner in its container, the initial applet, translation working, with tests and a PR (not merged).

- [x] **2.2 Move chat to PoC 2?** — The user suggested it, to shrink PoC 1. PoC 1's scenario (translation as the user types) doesn't need chat.
  - Saves: the chat pane with streaming, the chat path over the JSON websocket, chat flushing a batch, and `<chat>` encoding.
  - Loses: the user can't steer the runtime agent mid-session; the chat flush goes untested until PoC 2.
  - PoC 1's open questions don't need chat: change batches arriving mid-turn exercise Claude Code's queueing just as well.
  - The runtime agent's text output still matters (does it chat instead of patching? does it reply at all?), and the JSON Lines event log shows it.
  - Decision: **move chat input and streaming to PoC 2**, and watch the runtime agent's text in the event log. Keep the `<chat>` encoding in the design, unused in PoC 1. To steer the runtime agent, restart with different scenario instructions.

## 3. Implementation

- [x] **3.1 Where the PoC's initial applet lives** — Decision: `packages/translation-applet`, a workspace package holding the applet source as it would sit in `work/` (`main.tsx`, `schema.ts`, `components/ui/`). `initial-state.json` next to it is the harness's initial state. `bootstrap-applet` stays reserved for PoC 2's near-blank canvas.

- [x] **3.2 Where the applet is built** — The design builds in the runtime agent container. Decision: the container image build runs `vite build` once (`docker/runtime-agent/Dockerfile`). PoC 1 has no publishing, so building at container start would add seconds for nothing. The runtime agent's `work/` is a copy of the applet source, for reading only in PoC 1, and isn't a git repo yet.

- [x] **3.3 One bundle, no import map** — The PoC 1 loader is trivial: Vite aliases `@applet/main` to the applet's `main.tsx` and `@harness/state` to `applet-runtime/src/state.ts`, and builds loader, store and applet into one bundle. The import map and React Refresh arrive with the real loader in PoC 2.

- [x] **3.4 `@harness/state` exports `updateText`** — The design's store API has only `use` and `change`. An applet that assigns a string in a change function creates a new text object, which discards concurrent edits to it, including the runtime agent's (state.md, "Applying the runtime agent's patches"). Decision: `@harness/state` re-exports automerge-repo's `updateText`, and PoC 2's runtime instructions should tell the runtime agent to use it for strings. `store.use<S>()` and `store.change<S>()` take the state type as a type parameter, since the protected module can't import the applet's `State`.

- [x] **3.5 Which peers the harness UI trusts** — automerge-repo's `shareConfig` sees only peer IDs, which peers choose for themselves. Decision: **default deny**. The harness UI trusts only the harness server's peer ID, which is random (`harness-<uuid>`) and which only the harness UI learns (from `/api/session`). Every other peer, including the iframe, may access only the active state doc, and is announced nothing.

- [x] **3.6 Excluding the runtime agent's own changes** — The design records doc heads around each harness write. Decision: `DocHandle.change` emits its change event synchronously, so the harness sets a flag around its own `change` call and ignores events while it's set. Same effect, less bookkeeping; tested in `server.test.ts`.

- [x] **3.7 Runner connection** — The runner connects out to the harness (`ws://host.docker.internal:5170/runner`), authenticated by a random token the harness passes to the container. The harness starts the container itself with `docker run` (non-root, `--cap-drop ALL`, `no-new-privileges`, memory and process limits), after removing any container left from an earlier run.

- [x] **3.8 Runtime instructions** — General instructions are a read-only `CLAUDE.md` in `work/`, loaded by the SDK's `settingSources: ["project"]`. Scenario instructions are appended to Claude Code's system prompt. Both are in `docker/runtime-agent/`.

- [x] **3.9 Runtime tools load eagerly** — Claude Code defers MCP tools behind its ToolSearch tool by default, which cost the first turn of each session an extra model round trip. Decision: `createSdkMcpServer({ alwaysLoad: true })`.

- [x] **3.10 Line endings** — `.gitattributes` sets `eol=lf`, so Biome's formatter agrees with checkouts on Windows (`core.autocrlf=true`).

## 4. Findings

From three manual sessions in the browser on Sonnet 5 (2026-09-24):

- **Translation works** in both directions, including clearing a side.
- **Excluding the runtime agent's own changes works:** it never received its own patches, and never reacted to its own output.
- **Mid-turn input queues correctly:** changes flushed while it was working arrived as its next turn, and it translated the newer text.
- **Lag:** the batch flushes 1.5 s after the last keystroke, and the patch lands 1.2–1.4 s after that in a warm session (3.6 s on a session's first turn). About 3 s from the last keystroke in total.
- **It ends each turn with "Done."**, despite instructions not to, and despite a "No reply is needed." suffix on `patch_state` results (tried and removed). The translation lands before it, so the user doesn't wait; it keeps the status on "Working" about 0.5 s longer and delays the next queued input by as much.
- **Cost:** the SDK's estimate was $0.03–0.12 for a session's first turn and about $0.014 per later turn (it reports a session total).
- **A stopped harness can leave the container running:** when the harness is killed without a chance to clean up, the runner's websocket doesn't notice, so the runner doesn't exit. The next harness start removes the container.
