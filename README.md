# Familiar

A malleable app: a Claude Code agent in a sandboxed container rewrites the app live as you use it, and acts inside it. See [the high-level design](docs/designs/high-level-design.md).

Status: **PoC 1, live translation.** Type in the English or Spanish box, pause, and the runtime agent fills in the other side.

## Running it

Needs Node 24+, pnpm 12, Docker, and a Claude Pro, Max, Team or Enterprise subscription.

1. Create a subscription token with `claude setup-token`, and put it in `.env` at the repo root (git-ignored):

   ```
   CLAUDE_CODE_OAUTH_TOKEN=...
   ```

2. Install, and build the runtime agent's image. Rebuild the image after changing `packages/runner`, `packages/applet-runtime`, `packages/translation-applet` or `docker/runtime-agent`.

   ```bash
   pnpm install
   pnpm runtime:build
   ```

3. Start the harness (which starts the container) and the harness UI, then open http://localhost:5173.

   ```bash
   pnpm dev
   ```

Each run starts from scratch. The event log for each session is in `logs/`.

Environment variables for `pnpm dev`: `FAMILIAR_MODEL` (default `claude-sonnet-5`), `HARNESS_PORT` (5170) and `APPLET_PORT` (5174).

## Developing

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Coding agents: start with [AGENTS.md](AGENTS.md).
