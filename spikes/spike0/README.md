# Spike 0

Throwaway code answering the Spike 0 questions in [the roadmap](../../docs/designs/roadmap.md#spike-0-throwaway-code). Findings go into the design docs.

```bash
pnpm install
```

## Automerge checks (`automerge/`)

```bash
pnpm exec vitest run automerge
```

- `jsonpatch.ts`: Automerge patches → JSON Patch (text edits become whole-string `replace`), and JSON Patch → Automerge draft mutations (string replaces via `updateText`).
- `jsonpatch.test.ts`: conversion round trips, including 1000 randomized changes.
- `changeAt.test.ts`: applying the runtime agent's JSON Patch at old heads while the user edits concurrently.
- `repo.test.ts`: `find()` readiness and `shareConfig` in a server ↔ ui ↔ iframe topology over MessageChannels.

## Loader experiment (`loader/`)

```bash
node loader/build.mjs
node loader/serve.mjs
```

Open http://localhost:5180/?mode=element (or `call`, `refresh`). Type in the inputs, scroll the list, click +1, then press Alt+2 to activate v2 without moving focus. `mark()`, `snapshot()` and `activate("v2")` in the console measure what survived.
