---
name: dw-grill
description: Stress-test a plan or design by interviewing the user one decision at a time, with a recommended default for each.
---

# /dw-grill

Run the grilling interview engine over a plan, design, spec, or refactor: surface every
open decision and drive each to a resolution, **one question at a time**, leading with a
recommended default the user can confirm in a word. Prompt-driven — no scripts.

## Invocation

`/dw-grill [optional topic, plan, or file/PR reference]`

- With a topic: grill that.
- Without one: grill whatever plan/design is in context (this conversation, a recent
  diff, an open spec). If nothing concrete is in scope, ask in one line what to grill.

## Flow

1. Map the decision tree for the topic; order decisions so none depends on a later one.
2. For each open decision, **resolve from the codebase first** — explore instead of
   asking when the answer already exists, and tell the user what you found.
3. Ask **one** remaining question, leading with your recommended default and the
   one-line trade-off. Make it answerable in a word.
4. Wait for the answer. Do not stack questions. Re-prune the tree if the answer changes
   what's still open.
5. Repeat until no material decision is unresolved.
6. End with a **resolved-design summary**: every decision and its outcome, so the work
   is unambiguous to build from. Name anything deliberately left open.

## Hard rules

- One question per turn; always wait for the answer.
- Every question leads with a recommended default and trade-off — never a bare open ask.
- Explore the codebase before asking the user.
- Never silently assume — resolve, or defer it explicitly in the summary.

Full engine and question-writing guidance: this skill's `SKILL.md` and
`references/asking-well.md`.
