---
name: dw-grill
description: Stress-test a plan by asking only product decisions with real impact, one at a time, each with a recommended default.
---

# /dw-grill

Run the grilling interview over a plan, design, spec, or refactor. Ask only product
decisions that pass the bar in `SKILL.md`, **one question at a time**, each with a
recommended default. Apply engineering defaults from the harness, user rules, and
dw-knowledge; list them under Assumed. Zero questions is a finished grill. Prompt-driven, no scripts.

## Invocation

`/dw-grill [optional topic, plan, or file/PR reference]`

- With a topic: grill that.
- Without one: grill whatever plan/design is in context (this conversation, a recent
  diff, an open spec). If nothing concrete is in scope, ask in one line what to grill.

Full engine and question-writing guidance: this skill's `SKILL.md` and
`references/asking-well.md`.
