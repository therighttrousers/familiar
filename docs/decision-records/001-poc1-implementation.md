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

- [~] **2.2 Move chat to PoC 2?** — The user suggested it, to shrink PoC 1. PoC 1's scenario (translation as the user types) doesn't need chat.
  - Saves: the chat pane with streaming, the chat path over the JSON websocket, chat flushing a batch, and `<chat>` encoding.
  - Loses: the user can't steer the runtime agent mid-session; the chat flush goes untested until PoC 2.
  - PoC 1's open questions don't need chat: change batches arriving mid-turn exercise Claude Code's queueing just as well.
  - The runtime agent's text output still matters (does it chat instead of patching? does it reply at all?), and the JSON Lines event log shows it.
  - Leaning (agent's recommendation, awaiting the user): **move chat input and streaming to PoC 2**, and watch the runtime agent's text in the event log. Keep the `<chat>` encoding in the design, unused in PoC 1.
