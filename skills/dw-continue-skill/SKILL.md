---
name: dw-continue-skill
description: Resume from the handoff dw-handoff already wrote without re-planning; invoke /dw-continue.
disable-model-invocation: true
---

# Continue: execute the handoff's next step

Resume work **`dw-handoff-skill`** already captured. This skill owns **no state**, writes **no
second plan**, and does **not** edit `dw-handoff-skill`.

## Invocation

`/dw-continue`

Only valid when the user typed this command — not when another skill or the model "continues"
informally.

## Locate the handoff (read-only)

Use **`dw-handoff-skill`'s** path scaffold — do not invent a path. From the `dw-handoff-skill`
directory:

```bash
node scripts/dw-handoff-path.js [--focus "next-session focus"]
```

It prints the absolute handoff `.md` path (store handoffs dir, outside the working tree). Read
that file if it exists. Optional `--focus` only if the user supplied the same focus when they
last wrote the handoff; otherwise omit it.

If no file exists at the resolved path, tell the user to run **`/dw-handoff`** (optionally with
a focus). That command is user-facing; **you cannot invoke `dw-handoff-skill` yourself** — hand
the instruction to the human and stop.

## Steps

1. **User invocation.** This run starts only because the user invoked `/dw-continue`. *Done
   when:* that is the invocation (not an inferred "continue").

2. **Load handoff.** Resolve the path with `dw-handoff-path.js` and read the document. *Done
   when:* file contents are in hand, or you have reported that none exists at the resolved path.

3. **Missing handoff.** If none exists, tell the user to run **`/dw-handoff`**. Stop. Do not
   invent a plan or substitute investigation. *Done when:* you have stopped without writing a
   new plan.

4. **Five-line reply.** Reply with **exactly five lines**, drawn from the handoff — no other
   tool work in that turn:

   1. Where it stopped (from **Current state**).
   2. The next step (first item under **Next steps**).
   3. What not to redo (what is already done or settled — **Current state** / **Key decisions &
      constraints**).
   4. Blockers (**Gotchas** or explicit blockers in the doc).
   5. What is already decided (**Key decisions & constraints**).

   *Done when:* those five lines are the **whole** reply for that turn.

   | Excuse | Reality |
   |---|---|
   | "Five lines are not enough, keep going" | The fifth line ends the turn. Wait for the user. |

5. **Wait.** Hold until the user replies. *Done when:* the user has sent a follow-up message.

6. **Do the next open step.** Perform the next open step already written in the handoff's
   **Next steps** (or the step the user's reply selects if they point at one). Do not re-ground,
   re-read the codebase for a fresh plan, or rewrite the checklist. *Done when:* that step's
   own done-condition is met, or the user stops you.

   | Excuse | Reality |
   |---|---|
   | "The handoff looks stale, re-investigate" | The handoff is the plan. Re-grounding is the failure this skill exists to prevent. |

## Related skills (pointers only)

- **`dw-handoff-skill`** — writes or refreshes the handoff (`/dw-handoff`); you only read via
  `scripts/dw-handoff-path.js`.
- **`dw-flow-skill`**, **`dw-git-ops-skill`**, others — use only when the handoff's **Next
  steps** or **Suggested next skills** name them; do not paste their procedures here.
