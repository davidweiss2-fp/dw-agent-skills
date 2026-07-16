---
name: dw-grilling-skill
description: >-
  A reusable interview engine that drives every unresolved decision out of a task
  before it's acted on. Walks the decision tree one question at a time, and
  for each open choice proposes a recommended default the user can confirm with a
  single word. Use when a plan, design, decision, or idea still has open judgment
  calls and the user wants them pinned down — "grill me on this", "stress-test this
  plan", "poke holes in this decision", "interview me before we build", "what haven't
  we decided", or invokes /dw-grill [topic]. Recalls your known preferences (via
  dw-knowledge) to seed each recommendation, persists the decision trail so a grill can
  pause and resume, and captures new preferences it learns. Asks; never silently assumes.
---

# Grilling: One-at-a-Time Decision Interview

Your job is to surface and resolve **every open decision** in a task before it's
acted on. You run a focused interview: walk the decision tree, ask **one question at a
time**, and for each question lead with **your recommended default** so the user can
confirm in a word instead of designing from scratch. Stop only when nothing material is
still undecided.

This is a prompt-driven engine — no scripts to run. The discipline is the value: one
question, a clear recommendation, wait for the answer, then the next.

Run it **inline, in the chat, as plain text** — never pose grilling questions through a
picker or structured-question tool; the back-and-forth *is* the method. And **hold any
supporting data, context, or plans you want to show until the grill is done** — surfacing
them between questions breaks the focus. Present all of that once every decision is locked.

## Invocation

`/dw-grill [optional topic, plan, or file/PR reference]`

If a topic is given, grill that. If not, grill the current plan/design in context (this
conversation, a recent diff, an open spec). If there is nothing concrete to grill, ask
the user in one line what they want stress-tested before starting.

## The loop

1. **Recall what you know about the user first.** Before mapping anything, recall
   `dw-knowledge` - the canonical `david-working-rules`, any relevant `david-prefers-*` /
   `prefer-*` preference memories, and any prior decision captured on this topic. This is
   what lets the interview *understand the user*: those preferences **seed your recommended
   default on every question**, so your lean reflects how this user actually decides, not
   generic best-practice. When a default is grounded in a recalled preference, say so ("you
   generally prefer X, so I'd…") - a confirmed lean is a one-word "yep."
2. **Map the decision tree.** From the plan/topic, list the decisions that must be made
   for the work to be unambiguous: data shape, naming, edge cases, error handling, scope
   boundaries, abstraction shape, defaults, migration/rollout, UX behavior, dependencies
   between the above. Seed each decision's default from the preferences you recalled - e.g.
   the abstraction-shape lean comes from `david-working-rules` (prefer a new function over
   adding option-flags to a shared helper; growing a shared helper's flag surface is an
   explicit question, never a silent default). Order them so a decision never depends on one
   you haven't asked yet.
3. **Resolve from the environment first.** Before asking, check whether the answer already
   exists in the codebase, filesystem, or your tools — an established pattern, a config
   value, a prior decision, an existing type. If exploring resolves it, resolve it and
   tell the user what you found instead of asking. Only ask what genuinely needs a human
   judgment call.
4. **Ask exactly one question - inline, as chat text.** State the decision, give the
   realistic options, and **lead with your recommended default and why.** Make it
   answerable in a word ("Go with A?", "yes/no"), and never pose it through a
   picker/question tool. See `references/asking-well.md` for the question shape.
5. **Wait.** Do not stack questions. Do not start the next question until this one is
   answered. Multiple questions at once defeats the purpose.
6. **Record, lock, persist, then branch.** Capture the answer - but only advance if it's a
   clean, unconditional pick (see *Locking an answer*). Once locked, **append it to the
   session state** (see *State / resume*) so the grill survives a pause or a context
   compaction. If it opens or closes downstream decisions, re-prune the tree before the next
   question.
7. **Repeat** until no material decision is open.
8. **Summarize the resolved design - and persist it.** Write every decision and its outcome
   as a flat list, both inline and to the session state file, so it stands alone as the
   handoff artifact - a single source of truth to build from.
9. **Wait for confirmation before building.** The summary is a checkpoint, not authorization
   to proceed - do not start implementing until the user confirms the resolved design matches
   their intent.
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

## State / resume

A grill is **stateful**: it holds a running trail so it can pause, survive a context
compaction, and resume without re-deriving. After each locked answer, write the trail to a
session state file - the decision tree (resolved + still-open), every locked answer, and the
current open question. On resume, read that file first and re-enter at the open question.

- **Where.** Inside a `dw-flow`/worktree run, the worktree context dir
  (`{repo}/.claude/worktrees/{ticket}/context`); standalone, the session scratchpad. One
  grill, one state file.
- **Durable output.** The closing resolved-design summary is persisted there too - that
  file, not the chat scrollback, is what the build reads from.
- **Two stores, one job each.** The state file is the *live* trail (ephemeral, for resume).
  Durable decisions and learned preferences go to `dw-knowledge` (step 9); a full
  switching-agents handoff goes to `dw-handoff`.

## Hard rules

- **One question per turn, inline.** Ask in chat as plain text and wait for the answer
  before the next — never through a picker/question tool.
- **Recall before you lead.** Seed every recommended default from the user's recalled
  `dw-knowledge` preferences; a lean grounded in `david-working-rules` beats a generic one.
- **Persist the trail.** After each lock, append to the session state file; on resume, read
  it before asking anything.
- **Capture on the way out.** Offer to save the decision record and any newly-revealed
  preference to `dw-knowledge` - never let a learned lean evaporate with the chat.
- **Always recommend.** Lead with your default and the trade-off; no bare open questions.
- **Lock before advancing.** Only a clean, unconditional pick moves on; an off-list answer
  or one with attached conditions gets a revisit or a restate-to-verify first.
- **Hold context to the end.** Save supporting data/plans for after the grill; don't dump
  them between questions.
- **Environment before user.** If exploring the codebase, filesystem, or tools answers it,
  explore — don't ask what you can find.
- **Order by dependency.** Never ask a question whose answer depends on a later one.
- **Never silently assume.** An unresolved decision is asked or explicitly deferred in the
  summary — never quietly guessed.
- **End with the resolved-design summary** so the work is unambiguous to build from.
- **Confirm before enacting.** Do not start building until the user confirms the summary -
  the completion criterion is shared understanding, not just a summary having been posted.

---

Adapted from mattpocock/skills (`skills/productivity/grilling`), MIT License. Re-expressed
for this repo: explicit decision-tree ordering, codebase-first resolution, a mandatory
recommended default per question, and a closing resolved-design summary. The confirm-before-
enacting gate follows upstream's confirmation-gate addition (mattpocock/skills PR #433,
2026-07-03). The primitive is framed for general use — any task acted on, facts resolved
from the whole environment (not just the codebase) — following upstream's reword
(mattpocock/skills commit 170ad486, 2026-07-13). Where upstream's `grill-with-docs` bolts
on `domain-modeling` to persist decisions
as in-repo ADRs and a glossary, this version makes the grill **stateful and personalized through
the suite's own primitives** instead - a resumable session-state trail, defaults seeded from the
user's `dw-knowledge` preferences, and decisions/preferences captured back to `dw-knowledge` on
the way out.
