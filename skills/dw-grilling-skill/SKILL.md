---
name: dw-grilling-skill
description: >-
  A reusable interview engine that asks only product decisions with real impact
  before a task is acted on. A question must change what a person gets, or commit
  something expensive to undo, and still be open after user rules, dw-knowledge
  preferences, and the codebase are applied. Walks that short list one question at
  a time, each with a recommended default. Use when a plan still has a real product
  fork: "grill me on this", "stress-test this plan", "poke holes in this decision",
  "interview me before we build", "what haven't we decided", or invokes /dw-grill
  [topic]. Engineering defaults the harness, user rules, or preferences already
  cover are applied and listed, not asked. An empty question list is a finished grill.
---

# Grilling: One-at-a-Time Decision Interview

Your job is to ask the product decisions that change the outcome, and to apply
everything else. Walk the questions that pass the bar below, **one question at a
time**, each with a recommended default the user can confirm in a word. Stop when
no question passes the bar. An empty list is a finished grill.

This is a prompt-driven engine — no scripts to run. The discipline is the value: one
question, a clear recommendation, wait for the answer, then the next.

Run it **inline, in the chat, as plain text** - pose every grilling question as chat text the
user reads and answers in line; the back-and-forth *is* the method. And **hold any
supporting data, context, or plans you want to show until the grill is done** — surfacing
them between questions breaks the focus. Present all of that once every decision is locked.

## Invocation

`/dw-grill [optional topic, plan, or file/PR reference]`

If a topic is given, grill that. If not, grill the current plan/design in context (this
conversation, a recent diff, an open spec). If there is nothing concrete to grill, ask
the user in one line what they want stress-tested before starting.

## What is worth a question

Ask only when all three are true:

1. **Product impact.** The answer changes what a person gets (behavior, who it is for, what is in or out), or it commits something expensive to undo (public API, migration, billing, privacy, rollout).
2. **Still open.** No user rule, `david-working-rules`, `david-prefers-*` / `prefer-*` memory, prior decision, or established codebase pattern already picks it. User rules and those memories are already locked, including communication and context-summary behavior. On a conflict, the user rule wins.
3. **A real fork.** Two outcomes a stakeholder could actually want.

Anything else: decide, write one line under **Assumed**, and move on. Naming, error handling, abstraction shape, defaults, edge-case mechanics, data-shape internals, file layout, and tests stay in that bucket. A recalled preference is applied. Ask only when the plan would override it, such as adding an option-flag to a shared helper. Zero questions left: say "No product decision open.", list Assumed, and stop.

## The loop

1. **Recall what you know about the user first.** Before mapping anything, recall
   `dw-knowledge` - the canonical `david-working-rules`, any relevant `david-prefers-*` /
   `prefer-*` preference memories, and any prior decision captured on this topic.
   Apply them. A recalled preference closes the decision. Record it under Assumed.
   Ask only when the plan would override one.
2. **Map only candidates that might pass the bar.** From the plan/topic, list product
   outcome, who it is for, what is in or out of the user-facing result, and commitments
   that are expensive to undo. Drop naming, error handling, abstraction shape, defaults,
   edge-case mechanics, data-shape internals, file layout, and tests. Order the remaining
   candidates so each depends only on ones already settled.
3. **Look up the facts; apply closed decisions.** Finding facts is your job, never the
   user's. Before asking, check the codebase, filesystem, user rules, and `dw-knowledge`.
   A user rule, a preference, a prior decision, or an established pattern closes the
   decision. Apply it and list it under Assumed. Ask only when the bar still passes.
4. **Ask exactly one question - inline, as chat text.** State the decision, give the
   realistic options, and **lead with your recommended default and why.** Make it
   answerable in a word ("Go with A?", "yes/no"), posed as inline chat text. See
   `references/asking-well.md` for the question shape.
5. **Wait.** Ask a single question and hold; start the next only once this one is
   answered. Multiple questions at once defeats the purpose.
6. **Record, lock, persist, then branch.** Capture the answer - but only advance if it's a
   clean, unconditional pick (see *Locking an answer*). Once locked, **append it to the
   session state** (see *State / resume*) so the grill survives a pause or a context
   compaction. If it opens or closes downstream decisions, re-prune the tree before the next
   question.
7. **Repeat** until no question passes the bar.
8. **Summarize the resolved design - and persist it.** Write every asked decision and its
   outcome, plus the Assumed list, as a flat list, both inline and to the session state
   file, so it stands alone as the handoff artifact - a single source of truth to build from.
9. **Wait for confirmation before building** when this grill is standalone (`/dw-grill`).
   The summary is a checkpoint. Inside `dw-flow`, the Plan gate is that confirm; do not
   ask again here.
10. **Capture what you learned** *(offer, via `dw-knowledge`)*. Two things are worth saving:
    the **decision record** for this topic ("what we decided about {topic} and why"), and any
    **new preference** the grill revealed - a default you'd now lead with next time, because
    the user overrode or confirmed one in a way that generalizes. Offer to save the decision
    record and to fold the preference into `david-working-rules`. This is the loop that makes
    each grill understand the user a little better than the last.

## What counts as "one question"

One **decision**, not one sentence. You may show the options and your reasoning, but the
user should have to make a single call to move on. If you catch yourself writing "also,"
or a second "?", split it into the next turn.

## Locking an answer before you advance

An answer only moves the interview forward when it's a **clean, unconditional pick** of an
option you offered. It is **not** locked — and you do **not** go to the next question —
when the user:

- picks something **off your list** (a different option than any you proposed), or
- accepts an option but **attaches conditions or how-to comments** ("yes, but do it this
  way…", "agree, except…").

In either case the next turn stays on the *same* decision: either **revisit** it (fold
their input into a tightened set of options and re-ask), or **restate to verify intent** —
play back exactly what you now understand the decision to be and get a one-word
confirmation (the same intent-gate move `dw-flow` uses). Only once it's cleanly confirmed
do you record it and move on. A restate that reveals you'd captured more (or less) than the
user meant is the mechanism working, not a wasted turn.

## The recommended default is mandatory

Every question carries your lean: the option you'd pick
and the one-line trade-off behind it. A good default lets the user reply "yes" and keep
moving; a bare "what do you want to do?" makes them do the work the interview was meant
to save. If you genuinely have no lean, say so explicitly and give the smallest set of
real options — but that should be rare. See `references/asking-well.md`.

## When to stop

- No remaining candidate passes the bar. Say "No product decision open." List Assumed. Stop. That is a finished grill, and the summary goes out in that same turn.
- Every question that passed the bar is resolved by the user.
- Remaining unknowns are reversible one-liners. Flag them under Assumed.
- The user calls it. "good enough, let's build." Honor that, and name any product decision that still passes the bar.

## State / resume

A grill is **stateful**: it holds a running trail so it can pause, survive a context
compaction, and resume without re-deriving. After each locked answer, write the trail to a
session state file - the decision tree (resolved + still-open), every locked answer, and the
current open question. On resume, read that file first and re-enter at the open question.

- **Where.** Inside a `dw-flow`/worktree run, the worktree context dir
  (`~/Documents/dw-agent-store/run-notes/<project-slug>/`); standalone, the session scratchpad. One
  grill, one state file.
- **Durable output.** The closing resolved-design summary is persisted there too - that
  file, not the chat scrollback, is what the build reads from.
- **Two stores, one job each.** The state file is the *live* trail (ephemeral, for resume).
  Durable decisions and learned preferences go to `dw-knowledge` (step 9); a full
  switching-agents handoff goes to `dw-handoff`.

## Hard rules

- **One question per turn, inline.** Ask in chat as plain text and wait for the answer
  before the next; every question stays chat text answered in line.
- **Recall before you act.** Apply `dw-knowledge` preferences and user rules. Ask only to override one. A lean grounded in `david-working-rules` is the action, not a question.
- **Persist the trail.** After each lock, append to the session state file; on resume, read
  it before asking anything.
- **Capture on the way out.** Offer to save the decision record and any newly-revealed
  preference to `dw-knowledge` so a learned lean outlives the chat.
- **Always recommend.** Lead with your default and the trade-off; no bare open questions.
- **Lock before advancing.** Only a clean, unconditional pick moves on; an off-list answer
  or one with attached conditions gets a revisit or a restate-to-verify first.
- **Hold context to the end.** Save supporting data/plans for after the grill; present
  them once every decision is locked.
- **Closed decisions stay closed.** Look up facts in the codebase, filesystem, user rules, and `dw-knowledge`. A rule, preference, prior decision, or established pattern closes the decision. Ask only when the question bar still passes.
- **Order by dependency.** Ask each question only after the ones its answer depends on.
- **Surface every assumption.** List applied defaults under Assumed. Ask a decision only when it passes the question bar. Never quietly guess a product fork.
- **End with the resolved-design summary** so the work is unambiguous to build from.
- **Confirm before enacting.** A standalone grill waits for the user to confirm the summary. Inside `dw-flow`, the Plan gate is that confirm. The completion criterion is shared understanding, not just a summary having been posted.

---

Adapted from mattpocock/skills (`skills/productivity/grilling`), MIT License. Re-expressed
for this repo: explicit decision-tree ordering, codebase-first resolution, a mandatory
recommended default per question, and a closing resolved-design summary. The confirm-before-
enacting gate follows upstream's confirmation-gate addition (mattpocock/skills PR #433,
2026-07-03). The primitive is framed for general use — any task acted on, facts resolved
from the whole environment (not just the codebase) — following upstream's reword
(mattpocock/skills commit 170ad486, 2026-07-13). Upstream's fact-versus-decision split
(mattpocock/skills PR #461, 2026-07-06, carried further in PR #586, 2026-07-16) is
narrowed here: user rules, `dw-knowledge` preferences, and established patterns close
the decision. Ask only when the question bar still passes. Where upstream's `grill-with-docs` bolts
on `domain-modeling` to persist decisions
as in-repo ADRs and a glossary, this version makes the grill **stateful and personalized through
the suite's own primitives** instead - a resumable session-state trail, defaults seeded from the
user's `dw-knowledge` preferences, and decisions/preferences captured back to `dw-knowledge` on
the way out.
