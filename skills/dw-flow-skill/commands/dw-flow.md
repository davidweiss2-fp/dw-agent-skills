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

1. **Intent** — restate the ask expanded (clear wording, fixed grammar, explicit call-to-action)
   plus a one-line desired output → confirm.
2. **Grill** — **invoke `dw-grilling`**; run its inline text interview to completion, uninterrupted.
3. **Plan** — approve the resolved-design summary before any code.
4. **Post-PR** — read the draft PR, then decide on `dw-pr-ready`.

## How to talk

Caveman **ultra** for thinking/model-facing, **full** for talking to the dev, **off** for
commit/PR/product-draft wording (professional prose, always).

Full engine: this skill's `SKILL.md`, `references/playbook.md`, `references/communication.md`.
