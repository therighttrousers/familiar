# Design and engineering documents

- [`designs/`](designs/AGENTS.md) describes **what is true now**: the current design, plus its open questions. Start with [`designs/high-level-design.md`](designs/high-level-design.md).
- [`decision-records/`](decision-records/AGENTS.md) records **why**: how decisions were reached, which options were rejected, and what was superseded. Read a record when you need the rationale behind part of the design.

## When to do what

- **Implementing:** follow the design docs. If the code must differ from them, or you hit a question they don't answer, stop and raise it with the user.
- **Deliberating** (a design meeting, or a substantive decision during implementation): create a decision record. See [`decision-records/AGENTS.md`](decision-records/AGENTS.md).
- **When a decision is made:** update the affected design docs so they state the result, and link the record that explains it.
- **When an open question is answered:** follow [`designs/AGENTS.md`](designs/AGENTS.md).
