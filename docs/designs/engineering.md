# Engineering

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.5, §3.7, §8.1–8.3
- [001-poc1-implementation.md](../decision-records/001-poc1-implementation.md): §3.1, §3.10

## Repo layout

A **pnpm workspace**:

| Package | Contents | Runs in |
|---|---|---|
| `protocol` | shared types for the RPC and event log | everywhere |
| `harness` | server, automerge-repo, event log, Anthropic API proxy | host (PoCs), harness container (MVP) |
| `harness-ui` | chat, toolbar, iframe host (trusted, so Vite is fine here) | browser |
| `runner` | Agent SDK driver and runtime tools | runtime agent container |
| `applet-runtime` | the loader and `@harness/state` (copied in read-only) | applet iframe |
| `bootstrap-applet` | the near-blank starting applet (from PoC 2) | runtime agent container (`dist/v0/`) |
| `translation-applet` | PoC 1's initial applet, laid out as in `work/`, with `initial-state.json` | runtime agent container |
| `docker/runtime-agent/` | Dockerfile, preinstalled packages, CLAUDE.md, scenario instructions | — |

**Spikes** live in `spikes/<name>/` (e.g. `spikes/spike0/`), outside the workspace, each with its own `package.json` and a README saying how to run it. They are throwaway: committed so findings can be reproduced, and deleted once real code supersedes them. Findings go into the design docs, not the spike.

## Tooling

TypeScript (strict), **Biome** (lint and format), **Vitest**. Node runs the TypeScript directly (type stripping), so there's no build step outside Vite. Files use LF line endings (`.gitattributes`).

How to run Familiar is in the [README](../../README.md).

## CI

GitHub Actions, in **one workflow**: `.github/workflows/ci.yml`. `main` accepts changes only through PRs, and its ruleset requires a single check, the **`ci-ok`** gate job, which fails if any other job failed. **When you add a CI job, add it to `ci-ok`'s `needs`**; the ruleset never changes. `needs` can't reach other workflows, so jobs go in `ci.yml`.

Current jobs: `docs-links` (relative links and heading anchors in all Markdown files) and `check` (`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Harness structure

**Harness state is per-session objects keyed by session ID:** batch timers, delivered heads (see [state](state.md#applying-the-runtime-agents-patches)), queues, the runner connection. No process-global singletons, so sessions can later be spread across servers (see [roadmap](roadmap.md#deployment-contexts)).

## Event log and observability

The harness keeps a per-session **JSON Lines event log**: one event per line, both directions, streamable, with no end tags. Event types include `user.chat`, `user.changes`, `agent.text`, `agent.tool` and `harness.publish`. Illustrative example (field names not yet decided):

```jsonl
{"t":"user.chat","text":"what's the total?"}
{"t":"user.changes","schema":3,"patches":[…]}
{"t":"agent.text","delta":"The total"}
{"t":"agent.tool","name":"patch_state","input":{…}}
{"t":"harness.publish","code":"v7","schema":3}
```

It is the single source of truth for the debug view (see [ux](ux.md#activity-feedback)), replay, chat history after a restart, and observability. The runtime agent's input encoding is a rendering of its user-side events (see [runtime agent](runtime-agent.md#message-encoding)).

Alongside it: Claude Code's own transcripts on the runtime agent container's volume, and the git history of `work/`.

## Cost controls

- A running cost counter in the harness UI, from the cost the SDK reports at the end of each turn.
- Under the subscription credential (see [security](security.md#credential)), that cost is an estimate, and the plan's usage limits are the backstop. They're shared with the user's other Claude use.
- A cheaper model for testing (see [runtime agent](runtime-agent.md#model)).
- Turn or budget limits only if we see runaway turns.

## Open questions

None yet.
