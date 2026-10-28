---
name: dw-continue
description: Resume from dw-handoff's document without re-planning or re-grounding.
---

# /dw-continue

Pick up where `dw-handoff-skill` left off. Read the existing handoff, reply in five lines, wait,
then execute the next open step from that document — no second plan.

## Invocation

`/dw-continue`

## Flow

1. Confirm the user invoked `/dw-continue`.
2. Resolve the handoff path from `dw-handoff-skill`:

   ```bash
   node ../dw-handoff-skill/scripts/dw-handoff-path.js [--focus "..."]
   ```

   Read the printed absolute path if the file exists.
3. If missing: tell the user to run **`/dw-handoff`** and stop (you cannot call that skill).
4. Reply with exactly five lines — where it stopped, next step, what not to redo, blockers,
   what is already decided — then wait.
5. On user reply, do the next open handoff step only; do not re-plan.

Full rules and rationalizations: this skill's `SKILL.md`. Handoff format and scrubbing:
`dw-handoff-skill`'s `SKILL.md`.
