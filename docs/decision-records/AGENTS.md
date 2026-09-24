# Decision records

The `docs/decision-records` directory contains a persistent log of decisions made while developing Familiar.
After a decision record file lands in the `main` branch, it MAY be corrected to be more precise or to more accurately represent history, but SHOULD NOT otherwise be changed.

Formal ADRs are not necessary.
We want the flexibility to include design aspects other than architecture.
We want to store only essentials: decision context, questions, options, and rationales.

Create a new file here when
- You and the user start a design meeting, or
- You are faced with a substantive decision during implementation.

Use the new file to track the decision context and decision state during deliberations.
Name it `NNN-short-slug.md`, numbering sequentially from `000`.

## Decision record format

Start with a `## Context` section: inciting event, goals, anti-goals, overarching questions, tensions - anything relevant.
The context can be changed while deliberating.

Use numbered sections (1, 2, ...) containing numbered list items (7.1, 7.2, ...).
In items, use checkboxes with the following statuses:
- `[ ]`: open
- `[~]`: leaning / tentative
- `[x]`: settled

Each item should contain the design question, options on the table, and the decision + rationale once made.

## Closing a record

When deliberation ends:
- Write each outcome into the relevant design docs in [../designs/](../designs/AGENTS.md), and add this record to their "Relevant decision records" lists.
- Move unresolved items (`[ ]`, `[~]`, or anything marked "to be checked") into those docs' "Open questions". Leave the items in the record as they are: the record shows where deliberation stopped.

## Citing records

Cite record items as `NNN §x.y`, e.g. `000 §1.4`.
