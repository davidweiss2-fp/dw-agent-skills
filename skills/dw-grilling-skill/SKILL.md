---
name: dw-grilling-skill
description: >-
  A reusable interview engine that drives every unresolved decision out of a task
  before any building starts. Walks the decision tree one question at a time, and
  for each open choice proposes a recommended default the user can confirm with a
  single word. Use when a plan, design, spec, or refactor still has open judgment
  calls and the user wants them pinned down — "grill me on this", "stress-test this
  plan", "interview me before we build", "poke holes in this design", "what haven't
  we decided", or invokes /dw-grill [topic]. Asks; never silently assumes.
---

# Grilling: One-at-a-Time Decision Interview

Your job is to surface and resolve **every open decision** in a task before code gets
written. You run a focused interview: walk the decision tree, ask **one question at a
time**, and for each question lead with **your recommended default** so the user can
confirm in a word instead of designing from scratch. Stop only when nothing material is
still undecided.

This is a prompt-driven engine — no scripts to run. The discipline is the value: one
question, a clear recommendation, wait for the answer, then the next.

## Invocation

`/dw-grill [optional topic, plan, or file/PR reference]`

If a topic is given, grill that. If not, grill the current plan/design in context (this
conversation, a recent diff, an open spec). If there is nothing concrete to grill, ask
the user in one line what they want stress-tested before starting.

## The loop

1. **Map the decision tree.** From the plan/topic, list the decisions that must be made
   for the work to be unambiguous: data shape, naming, edge cases, error handling,
   scope boundaries, defaults, migration/rollout, UX behavior, dependencies between the
   above. Order them so that a decision never depends on one you haven't asked yet.
2. **Resolve from the codebase first.** Before asking, check whether the answer already
   exists — an established pattern, a config value, a prior decision, an existing type.
   If exploring resolves it, resolve it and tell the user what you found instead of
   asking. Only ask what genuinely needs a human judgment call.
3. **Ask exactly one question.** State the decision, give the realistic options, and
   **lead with your recommended default and why.** Make it answerable in a word
   ("Go with A?", "yes/no"). See `references/asking-well.md` for the question shape.
4. **Wait.** Do not stack questions. Do not start the next question until this one is
   answered. Multiple questions at once defeats the purpose.
5. **Record and branch.** Capture the answer. If it opens or closes downstream
   decisions, re-prune the tree before the next question.
6. **Repeat** until no material decision is open.
7. **Summarize the resolved design** — every decision and its outcome — so the user has
   a single source of truth to build from. This is the handoff artifact.

## What counts as "one question"

One **decision**, not one sentence. You may show the options and your reasoning, but the
user should have to make a single call to move on. If you catch yourself writing "also,"
or a second "?", split it into the next turn.

## The recommended default is mandatory

Never ask a bare open question. Every question carries your lean: the option you'd pick
and the one-line trade-off behind it. A good default lets the user reply "yes" and keep
moving; a bare "what do you want to do?" makes them do the work the interview was meant
to save. If you genuinely have no lean, say so explicitly and give the smallest set of
real options — but that should be rare. See `references/asking-well.md`.

## When to stop

- Every decision on the tree is resolved (by the user or by the codebase).
- Remaining unknowns are immaterial to building, or are reversible one-liners you can
  flag in the summary rather than block on.
- The user calls it — "good enough, let's build." Honor that, but name any decision still
  left open so it's a conscious choice, not a silent gap.

## Hard rules

- **One question per turn.** Always wait for the answer before the next.
- **Always recommend.** Lead with your default and the trade-off; no bare open questions.
- **Codebase before user.** If exploring answers it, explore — don't ask what you can find.
- **Order by dependency.** Never ask a question whose answer depends on a later one.
- **Never silently assume.** An unresolved decision is asked or explicitly deferred in the
  summary — never quietly guessed.
- **End with the resolved-design summary** so the work is unambiguous to build from.

---

Adapted from mattpocock/skills (skills/productivity/grilling), MIT License. Re-expressed
for this repo: explicit decision-tree ordering, codebase-first resolution, a mandatory
recommended default per question, and a closing resolved-design summary.
