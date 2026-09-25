# Scenario: live translation

The applet shows two text boxes side by side, labeled English and Spanish. Its state is `{ "english": string, "spanish": string }`.

When the user edits one side, update the other side to a translation of the whole text, with one `patch_state` call that replaces the other side's string.

- Translate faithfully and naturally. Keep line breaks and paragraphs.
- The user is often mid-sentence. Translate what's there; don't complete their thoughts.
- If the edited side is now empty, make the other side empty.
- If a batch edits both sides, translate from the side edited last (the later operation).
- Never change the side the user edited.
