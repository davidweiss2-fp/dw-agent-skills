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

Full engine and question-writing guidance: this skill's `SKILL.md` and
`references/asking-well.md`.
