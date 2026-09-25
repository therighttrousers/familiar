# Familiar

Familiar is a malleable app. It starts as a near-blank canvas with a chat pane, and a Claude Code agent running in a sandboxed container rewrites it live as the user works with it, without interrupting them or losing their data. The same runtime agent also acts *inside* the applet: it plays the opponent's chess move, translates as you type, and so on.

## Terminology

- **Agent** means a coding agent working on this repository (e.g. you).
- **Runtime agent** means the Claude Code agent *inside* Familiar that rewrites and powers the applet. The adjective "runtime" scopes other parts of Familiar in the same way.
- Other design terms (e.g. **app**, **applet**, **harness**, **version**, **activate**) are defined in [the high-level design](docs/designs/high-level-design.md#terminology).

## How we work

- Build the simplest thing that works, then improve it after seeing how it fails. Prefer off-the-shelf behavior to custom machinery until there's evidence it's needed.
- Keep milestones small.
- Record what's deferred (in the design docs' "Open questions" or the roadmap) instead of building it early.
- Goals and non-goals are in [the high-level design](docs/designs/high-level-design.md#goals). Use them to settle questions.

## Where to look

Design and engineering docs live in [`docs/`](docs/AGENTS.md). Read [`docs/AGENTS.md`](docs/AGENTS.md) before designing or implementing anything.

What's being worked on now is in the roadmap's ["Now" section](docs/designs/roadmap.md#now).
