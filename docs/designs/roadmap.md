# Roadmap

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.1, §1.5, §7.1–7.4

## Now

- **Spike 0** is on branch `spike0` (code in `spikes/spike0/`). Done; the results are in the design docs.
- **Next:** PoC 1.

Keep this section short and current: it tells a new session what to work on.

## Milestones

**Spike 0 → PoC 1 (translation) → PoC 2 (spreadsheet) → MVP.** Spike 0 is needed only before PoC 2, so it and PoC 1 can happen in either order.

Throughout: **one user, one browser tab, localhost.** Multi-tab stays *possible* (G11) but untested. Multi-user is a non-goal (N1).

### Spike 0 (throwaway code)

Answers open questions for PoC 2 and the MVP. **Done**; the answers are in the linked docs.

- The loader switches between two built versions as each is activated (`dist/v1/`, `dist/v2/`) with an input mid-edit and a scrolled list. Does React remount? Does the import map share one React across versions? (See [code versions](code-versions.md#loader).)
- Automerge checks: `changeAt` at old heads, Automerge patch → JSON Patch conversion, `whenReady()` on a newly created doc, and whether automerge-repo can refuse a peer's request for an unoffered doc ID. (See [state](state.md#documents), [state](state.md#applying-the-runtime-agents-patches) and [runtime agent](runtime-agent.md#what-the-runtime-agent-sees).)

### PoC 1: live translation

**Scenario:** the initial applet is side-by-side multiline inputs labeled English and Spanish. The runtime agent is instructed to update the opposite side as the user types. This exercises the **observe → act loop** (change batches → `patch_state`) and the runtime agent's presence, with no code changes.

**In scope:**
- **Deployment:** harness on the host. Runtime agent container on a normal network, API key in its env (an accepted, known gap), non-root. It serves the fixed initial applet as a static build (`vite build` once, static server); the browser reaches it directly.
- **Runner:** Agent SDK streaming input. Tools: `get_state`, `patch_state`.
- **Harness:**
  - automerge-repo with **a single state doc** (no control doc), iframe sync through the parent
  - batching (1.5 s / 5 s / chat flush), message encoding, excluding the runtime agent's own changes from batches
  - JSON Lines log, per-session objects
- **Harness UI:** chat pane (streaming), toolbar with Send, basic status, iframe on a separate origin.
- **`applet-runtime`:** a trivial loader (renders the one applet), `@harness/state`.
- **Initial applet** (hand-written): the translation UI and its `State`. Tailwind and shadcn preinstalled.
- **Runtime instructions:** a first draft, plus scenario instructions.
- **Stale patches:** apply to the current doc and reject bad paths.
- **Text deltas:** whole-string `replace` ops.
- Starts from scratch each run.

**Out of scope:** publish, migrate, the `tsc` gate, multiple versions, the control doc, the readiness wait.

### PoC 2: spreadsheet

**Scenario:** "I need a spreadsheet" → a grid → the user types `=A1+1` → the runtime agent sees the change → adds a formula engine → the cell shows a number. This exercises the **rewrite loop**: chat → publish, change batches → publish, and **migration**. The first real applet migrates away from the bootstrap applet's `State`; the formula engine may migrate again.

**Adds:**
- The control doc and pointer.
- Publishing `work/` → `dist/v{n}/`, with the `tsc` gate, `migrate.ts` run in the container and archived, and a commit of `work/` on each publish. Tool: `publish_applet`.
- A state doc per schema version, and the readiness wait.
- The real loader with an import map and React Refresh (see [code versions](code-versions.md#preserving-ui-state-across-activations)).
- The bootstrap applet becomes the near-blank canvas.

### MVP

**Scenario:** PoC 2, plus **chess**. Chess exercises the runtime agent *acting* via `patch_state` in response to user moves, and staying present. Stretch: one more "intelligence inside the applet" demo from the [vision](high-level-design.md#vision), e.g. shopping-list allergens or interactive fiction.

**Adds:**
- **Deployment:** containerized harness (Docker Compose), internal network, API key proxy, applet server reverse-proxied through the harness.
- **Security:** full container hardening, the `PreToolUse` hook, the iframe `sandbox` attribute and CSP.
- **UI:** collapsible, responsive chat pane; hamburger menu.
- **Persistence:** resume across restarts (volume, SDK session resume, harness storage).
- **Feedback:** Revert button, "App updated" notice, solid/dots progress bar.
- **Tools for us:** debug view of all events, cost counter.
- **Stale patches:** applied at the runtime agent's last-seen heads (`changeAt`).

## Deferred (post-MVP)

Voice chat; `store` selectors; a richer loader with an error boundary that notifies the runtime agent and rolls back automatically; diffs and previews; undo/replay; multiple apps; npm egress; applet network access; model routing; the serve-container split; asking before big changes; `flush()` for applets; state transformers; a third kind of state, hidden from the runtime agent; prompt-injection defenses; a read-only root filesystem for the runtime agent container; minimal-diff migrations; re-running migrations or replaying edits lost to them.

## Deployment contexts

Familiar has two imagined deployment contexts. We check that no decision prevents the second, even though there is no plan to ship it; two contexts expose bad assumptions.

- **Dev machine** (the MVP): as described in the design docs. The runtime agent container also serves the applet, so the applet is briefly unavailable while that container restarts; accepted.
- **Cloud** (imagined): multi-tenant, many sessions.
  - A per-session runtime agent sandbox with stronger isolation than Docker (microVM or gVisor-class). It stays warm while the user is active and shuts down when they leave: the app requires the runtime agent, whose presence is the product.
  - A harness tier with sticky per-session routing.
  - Automerge storage in a database or object store.
  - Builds still run in the sandbox; published builds are immutable static artifacts served from object storage or a CDN, on a per-session origin.

Design choices that keep the cloud possible: opaque code version IDs, a disposable runtime agent container, per-session harness objects, no credentials in the iframe, no browser storage in applets, and no reliance on HMR.

Productization-only (not blocking): auth and tenancy, per-user keys and metering, sandbox runtime choice, egress policy as network policy.

## Open questions

What PoC 1 should tell us (raised in the design meeting, not recorded in 000):

- Does excluding the runtime agent's own changes stop it reacting to its own output?
- How well does Claude Code's queueing handle input arriving mid-turn?
- Is translation lag (1.5 s idle plus an Opus turn) acceptable?
