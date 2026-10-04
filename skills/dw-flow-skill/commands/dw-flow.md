---
name: dw-flow
description: Drive a substantial task from understanding to a merge-ready PR as one adaptive flow — ground, grill, build, deslop, review, ship — pausing only at four gates.
---

# /dw-flow

Run the workflow conductor over a substantial plan→ship task. It grounds context, grills the
plan, implements, deslops, reviews, and ships a draft PR, delegating to the other `dw-*` skills
and surveying in-scope skills as it goes. Adaptive, not rigid — every phase is reorderable and
skippable; only four gates stop it.

## Invocation

`/dw-flow [optional task or ticket]`

- With a task/ticket: drive that.
- Without one: drive whatever task is in context. If nothing substantial is in scope, say so in
  one line rather than engaging.

## Gates (the only stops)

1. **Intent** — restate the ask only when it is ambiguous or the scope changed, plus a one-line
   desired output, then confirm. A clear ask with a clear output is already confirmed; continue.
2. **Grill** — **invoke `dw-grilling`**. It asks only questions that pass its bar. Zero questions
   means the grill is finished; continue. Do not invent a question. The Plan gate is the confirm.
3. **Plan** — approve the resolved-design summary before any code; lock the success metric that
   proves the change worked in prod.
4. **Post-PR** — read the draft PR, then decide on `dw-pr-ready`.

Full engine: this skill's `SKILL.md` and `references/playbook.md`.
