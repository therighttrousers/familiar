# User experience

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §6.1–6.7

## Layout

- **The applet always exists.** The bootstrap applet is a near-blank canvas with a short, friendly, centered label saying what to do. It also simplifies logic, and serves as a one-shot example for the runtime agent.
- **One layout throughout:** the chat pane starts open, on the right or bottom depending on screen dimensions, and is collapsible.
- The **harness UI** is everything outside the applet iframe (the original project called it the "host UI"). It holds chat, Revert, and later credentials, cross-app settings and feature toggles. It is trusted and can't be modified by the runtime agent.
- **Harness toolbar**, under the chat input: a hamburger menu on the left, controls in the middle (later: microphone, headphones), Send on the right.

In the original project, a collapsible chat pane plus voice chat made chat feel woven into the app. With the runtime agent role-playing as the app, it felt like talking to the app itself.

## Chat

Chat lives in the **harness UI**, not in the applet.

- It's the recovery lifeline, and must work when the applet is broken (G7).
- It's the one channel where "the user said this" is certain, which matters for prompt injection and attribution (G8).
- Flushing pending changes on send happens inside the harness.
- It keeps future features like voice chat out of the runtime-agent-written applet.

The applet can still show conversational elements through state (e.g. chess trash talk).

Post-MVP: expose `flush()` to the applet through the loader (e.g. a "Submit move" button).

## Activity feedback

- The runtime agent's text **streams** into chat.
- A **progress bar above the message history**, with status text over it (e.g. "Editing Grid.tsx", from the SDK's tool-call stream). It is **solid** while the runtime agent is working, and shows **dots** while the harness holds a batch of changes for the user to finish (see [runtime agent](runtime-agent.md#batching)).
- An **"App updated"** notice after each publish, with Revert.
- By default, chat shows the runtime agent's text plus short action indicators. A **debug view** shows every event, including "nothing" turns, tool calls and code.

Post-MVP: diffs and previews.

## Consent for rewrites

The runtime agent **rewrites freely**, with Revert as the safety net. It chooses between updating the applet, changing state, chatting, or doing nothing (see [runtime agent](runtime-agent.md#response-options)).

Post-MVP: ask before "big" changes, likely defined as changes that would interrupt the user's flow. Leave the judgment to the runtime agent.

## Undo and history

**Revert only** (see [code versions](code-versions.md#rollback)). Reverting activates the previous version, including its state doc, which is acceptable: reverts are usually triggered by a type error or an immediate runtime error.

Post-MVP: undo/redo, built mostly on Automerge history, git and change attribution (G8). The main use case is demos: **deterministically replaying runtime agent actions**. The original project's hand-rolled undo was rarely used otherwise.

## Sessions and persistence

- **MVP:** one app at a time, surviving restarts. The docs are in harness storage, `work/` is on a volume, and the SDK session resumes.
- **PoCs:** start from scratch each run. To test from partway through a scenario, build an alternative initial applet and state.

Post-MVP: multiple apps, via an index doc (see [state](state.md#documents)).

## Open questions

- **Where Revert goes:** in the toolbar, or in the hamburger menu.
