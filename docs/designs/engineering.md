# Engineering

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.5, §3.7, §8.1–8.3

## Repo layout

A **pnpm workspace**:

| Package | Contents | Runs in |
|---|---|---|
| `protocol` | shared types for the RPC and event log | everywhere |
| `harness` | server, automerge-repo, event log, API key proxy | host (PoCs), harness container (MVP) |
| `harness-ui` | chat, toolbar, iframe host (trusted, so Vite is fine here) | browser |
| `runner` | Agent SDK driver and runtime tools | runtime agent container |
| `applet-runtime` | the loader and `@harness/state` (copied in read-only) | applet iframe |
| `bootstrap-applet` | the near-blank starting applet | runtime agent container (`dist/v0/`) |
| `docker/runtime-agent/` | Dockerfile, preinstalled packages, CLAUDE.md | — |

**Spikes** live in `spikes/<name>/` (e.g. `spikes/spike0/`), outside the workspace, each with its own `package.json` and a README saying how to run it. They are throwaway: committed so findings can be reproduced, and deleted once real code supersedes them. Findings go into the design docs, not the spike.

## Tooling

TypeScript (strict), **Biome** (lint and format), **Vitest**.

## CI

GitHub Actions, in **one workflow**: `.github/workflows/ci.yml`. `main` accepts changes only through PRs, and its ruleset requires a single check, the **`ci-ok`** gate job, which fails if any other job failed. **When you add a CI job, add it to `ci-ok`'s `needs`**; the ruleset never changes. `needs` can't reach other workflows, so jobs go in `ci.yml`.

Current jobs: `docs-links` (relative links and heading anchors in all Markdown files).

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
- A monthly spend limit in the Anthropic Console as the backstop.
- Turn or budget limits only if we see runaway turns.

## Open questions

None yet.
