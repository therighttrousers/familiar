# Design docs

The `docs/designs` directory describes Familiar's **current** design. When a design doc and a decision record disagree, the design doc wins; the record is history.

Start with [high-level-design.md](high-level-design.md). It has the vision, principles, goals, architecture overview and a map of the other design docs.

## Design doc format

- **Title**, then a **"Relevant decision records"** list linking the records that shaped the doc.
- **Body**: the design as it stands, in the present tense. State decisions, not deliberations. Keep rationale short and link the record for the rest.
- **"Open questions"** as the last section: anything still undecided or unverified. Not all of these are design questions; some are facts to check, or experiments to run.

## Keeping docs current

- **When an open question is answered:** write the answer into the body and delete the question. If answering it needed real deliberation, create a decision record (see [../decision-records/AGENTS.md](../decision-records/AGENTS.md)) and link it from the doc.
- **When a decision record closes:** its outcomes go into the relevant design docs, and its unresolved items move to those docs' "Open questions".
- **Superseded designs** don't belong here. Remove them; the decision record keeps the history.

## Cross-references

- **Between design docs:** Markdown links, with a heading anchor where useful, e.g. [state docs](state.md#documents).
- **To decision records:** `NNN §x.y`, e.g. `000 §1.4`, meaning record `000-*.md`, item 1.4. Record items are list entries rather than headings, so they have no link anchors. Link the record file itself in the doc's "Relevant decision records" list.
