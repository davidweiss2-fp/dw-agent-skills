---
name: dw-flow-skill
description: >-
  Conductor that takes a substantial task from understanding through a
  merge-ready PR — grounds context, grills the plan, implements, deslops,
  reviews, ships — delegating to the other dw-* skills at each step and
  surveying in-scope skills as it goes. Use for clearly-substantial plan→ship
  work: "take RD-1234 to a PR", "implement this and open a PR", "run the flow
  on this", "ship this end to end", or `/dw-flow [task]`. Engages only on
  multi-phase build/ship tasks — not quick questions, edits, or lookups; on
  self-engage it asks first. When a specific dw-* skill is invoked directly,
  that skill wins - the conductor yields to it.
---

# dw-flow — adaptive workflow conductor

The golden path that works most of the time, run as one coordinated flow: understand the
ask, ground it, grill the plan, build, deslop, review, ship. It is **adaptive, not a rigid
pipeline** — it drives the lifecycle and pauses only at four gates; between them it moves on
its own, picks the right skills, and you can redirect, reorder, or skip any phase at any time.

## Engagement

- **Explicit** `/dw-flow [task]` or "run the flow on this" → opted in; start at gate 1.
- **Model-invoked** → engage only on clearly-substantial plan→ship tasks. The first thing
  gate 1 does is ask "engage the conductor for this? y/n" before any other work.
- **Overlap** → when a `dw-*` skill is invoked directly (`/dw-grill`, `/dw-deslop`, …), that
  skill wins; the conductor yields to it.

## The four gates — the only stops

1. 🚪 **Intent** — restate the ask only when it is ambiguous or the scope changed, plus a
   one-line **desired output**, then confirm. A clear ask with a clear output is already
   confirmed; continue. Skip trivial steering replies (one-word answers, "go", redirects).
   On a model-invoke, this gate also carries the engage y/n.
2. 🚪 **Grill** — **invoke `dw-grilling`**. It asks only questions that pass its bar. Zero
   questions means the grill is finished; continue. Do not invent a question. The Plan gate
   is the confirm.
3. 🚪 **Plan** - approve before any code. Approvable only when the plan carries a **traced
   cause** (bug tasks) and a **placement contract** (both below), plus a clean **design-review**
   pass (`references/review.md`) - each cheap to fix on paper and ruinous to fix in code. Lock
   the **success metric** (how we'll know it worked in prod) here too.
4. 🚪 **Post-PR** — the draft PR is up and `dw-pr-ready` is already watching it; the dev decides
   when it flips to ready.

Between gates the conductor runs autonomously and is interruptible — redirect any time.

## The spine (default, adaptive)

Default order; reorder or skip per task. Each step names the skill it leans on. Full per-phase
playbook with completion criteria: `references/playbook.md`.

Open every phase by surveying the in-scope skills for *that* phase (see Skill discovery below).

1. **Ground** — recall `dw-knowledge`; gather codebase + ticket context (derive the ticket from
   the branch); recommend an approach. Bug tasks: establish root cause (below).
2. 🚪 **Grill** - **invoke `dw-grilling`**. It asks only questions that pass its bar. Zero
   questions means the grill is finished; continue. Do not invent a question.
3. **Simplify the plan** — `/simplify` the drafted plan before it goes to the gate; cut steps and
   scope beyond what the change needs.
4. 🚪 **Plan** - resolved-design summary → approve; it must carry the **traced cause** (bug
   tasks) and a **placement contract** (both below), plus a clean **design-review** pass
   (`references/review.md`). Lock the **success metric** (metric/query + expected direction) and
   write it, the placement contract, and the plan to the worktree context. Suggest a capture.
5. **Implement** — one Task per batch, `subagent_type: generalPurpose`, `model: composer-2.5`. The parent does not edit source. It applies only the subagent's summary. This overrides "do the first edit yourself" and "don't delegate a few-step change." On a host with no Task tool, delegate the edit to a subagent that host provides; the parent still does not edit source. Before the first Task, restate the objective with every deliverable and the evidence that will prove it, then call CreateGoal exactly once. Do not write a goal file by hand and do not retry creation. Put no time limit, token budget, or turn budget in the objective. The objective lists absolute paths to the approved plan, the grill record, the knowledge files in force, and the progress file. Keep that full objective intact across turns. Do not shrink it because the turn is ending. Write `~/Documents/dw-agent-store/run-notes/<project-slug>/implement-<scope>.md` with the subtasks that execute the approved plan, and update it as each finishes. If the work is multi-step, keep a TodoWrite list current too. Updating that list is not a substitute for the work. A replacement agent reads the progress file and those paths, inspects the working tree before trusting them, and continues the next open subtask. It does not re-plan. Call UpdateGoal complete only after a completion audit of the current tree proves every deliverable. Do not call UpdateGoal because the turn is ending.
6. **Ship it as a draft, and start keeping it ready** — `dw-git-ops` (`ops.sh cap "<message>"`
   then `ops.sh pr --title "<t>" --body "<b>"`, draft by default), then launch **`dw-pr-ready`** on
   it straight away. This runs *before* the quality passes on purpose: CI and the review bots start
   working the pushed code while `/simplify`, `dw-deslop` and `/code-review` run, so their findings
   arrive in parallel instead of serially after ship. The watcher holds through `waiting-draft`, so
   a draft PR is watchable from the moment it exists. Fold whatever it reports into the passes below
   rather than opening a second round after them.
7. **Simplify the diff** — `/simplify` the diff, then hand to Deslop.
8. **Deslop** — `dw-deslop` the diff.
9. **Review** - `/code-review` (or `fp-cdp-review` in that scope), run by the **review method**
   (`references/review.md`): blind to what was approved, iterating until a fresh pass is clean -
   for at most five rounds, then escalate to the dev with a brief.
10. **Verify** *(offered)* — `verify` the app for behavior; and before shipping run the repo's
    **preflight checks** via `dw-runbook` (lint/typecheck/test on the diff) and `fmt` the diff,
    folding the `fmt` patch into the commit; the proof of a green preflight is the result
    envelope from `run.js`, not a bare claim. Recall `dw-knowledge` for the repo's verify recipe
    (which runbook, how it runs, what it tolerates) rather than re-deriving or asking.
11. **Simplify before ship** — a final `/simplify` pass so the PR is the smallest correct change.
12. 🚪 **Ready** — propose a layer-split if large; preflight green, `fmt` applied, and everything
    `dw-pr-ready` surfaced answered → flip the PR out of draft (`ops.sh pr-ready`). The watcher is
    already running; it carries on from here.
13. **Post-merge verify** *(offered)* — once the PR merges, delegate to
    `dw-post-merge-verification`; it reads the plan-time success metric from the worktree context
    and rules the fix confirmed / no-effect / inconclusive.
14. **Capture** *(mandatory)* — `dw-knowledge`; especially the **how-to-git / commands /
    verify-ship flow** you worked out this task (these recur every task and stop the next agent
    re-deriving or asking). Auto-captured through the write gate, no confirm; runs every task.

## Skill discovery (every step)

Survey the skills available in the current scope and pick only the ones that are a genuinely good
call for the step — judgment, not mere relevance. Use them and **narrate what you use** ("running
`dw-deslop` on the diff"); no confirmation. Flag a **notable skip** in one line ("skipping
`verify` - nothing runnable here"); keep it to those. Discover skills live so the set stays
current as the skill set changes.

The survey picks among **model-invoked** skills only. A skill carrying
`disable-model-invocation: true` — `dw-skill-authoring` among them — can be run by nothing but a
human typing its name, so invoking one is a call that quietly does nothing. When the survey lands on
one, name it to the dev as a recommendation ("`/dw-skill-authoring` is the right tool for this — it's
user-invoked, so run it yourself") and carry on with the step.

## Root cause (bug tasks)

Ground every cause in evidence before editing. Search our APM (Coralogix) for the real error /
stack trace; if none is there, **ask the dev for the specific trace** so the cause rests on a real
signal. Then go past the error to the **mechanism**: trace the path from the real input to the
*exact* code that governs the behaviour - the true source of truth, not the first plausible gate -
and reproduce it where you can. A fix aimed at the wrong source of truth passes review and dies on
staging. Confirm this traced, reproduced cause at the Plan gate before any code.

## Placement contract (before code)

Approving the plan means approving a one-paragraph placement contract: **which unit owns the
state, who writes it, who reads it, and its lifecycle.** Architecture is gated here with the dev:
the specialist advises the mechanism (signal vs store, exact match, method names), and the gate
decides the concern boundaries - one unit owns one
concern (SRP), a presentation unit reads state from a light dependency-free holder, and state
stays limited to what the design needs. Editing this paragraph is free; reverting an implemented
design is costly.
What is gated vs. deferred: dw-knowledge `david-grill-defers-architecture-to-specialist`.

## Operating principles

Canonical source is `dw-knowledge`'s `david-working-rules` — on any divergence it wins; update there.

- Recall knowledge before starting any task.
- Guard the code: push back on hacks and recommend the better approach.
- Gather context and recommend an approach before asking.
- Iterate cheap - settle the design on paper (traced cause, placement contract, design review)
  before code, and hold staging deploys until the design is approved and reviewed: one deploy,
  after sign-off.
- A fix that guards a symptom is a design smell - treat it as a signal to redesign, and label a
  review idea as a *suggestion* or a *constraint* so a symptom-patch suggestion becomes a redesign
  trigger.
- Only touch files the task names; confirm before expanding scope; preserve TODO/context comments.
- Get approval before any product UI/UX change.
- Auto-fix behavior-preserving lint/test failures.
- Keep PRs small and reviewable; slice by layer (~300 LOC, split beyond ~500).
- Branch `{ticket}-{context}`; in the plan phase, derive the ticket from the branch.
- Worktree per ticket: persist to `~/Documents/dw-agent-store/run-notes/<project-slug>/` and read it first.
- Skill overlap → the `dw-` skill wins.
- Memory only via `dw-knowledge` (global store `~/Documents/dw-agent-store/knowledge/`) - the single persistence path.
- Before writing code, stop at the first step that already solves it: it does not need to exist; it is already in the codebase; the standard library; a native platform feature; an installed dependency; a one-liner; then the minimum code.
- Prefer deleting code over adding it. Do not add an abstraction the task did not ask for.
- Code edits are a Task: `subagent_type: generalPurpose`, `model: composer-2.5`, one batch per call. The parent does not edit source and applies only the summary. This overrides editing in the parent, including a few-step change. On a host with no Task tool, delegate to a subagent that host provides.
- Comments describe what/how; the why lives in the PR or commit.

## State / resume

At each gate, write a few lines to the worktree context dir — current phase, the approved plan, gate decisions. On resume, read it first and re-enter at that phase. During Implement, `implement-<scope>.md` in that dir lists the subtasks and the one in progress. A new agent reads that file and the paths named in the goal, inspects the working tree, and continues the next open subtask. It does not re-grill or re-plan. The goal stays active until a completion audit proves every deliverable. Full session handoff → `dw-handoff`.

## Hard rules

- Only the four gates stop the flow; everything else runs and stays interruptible.
- At the Grill gate, **invoke `dw-grilling`**. It asks only questions that pass its bar,
  one at a time, inline. Zero questions means the grill is finished; continue. Hold flow
  narration while a real question is in flight. Do not invent a question.
- Edit only on a proven cause - established from a real trace (APM or the dev) and traced to the
  true source of truth, not the first plausible gate.
- Review runs **blind to approval** - the reviewer's whole input is the artifact and the method,
  so it judges correctness fresh; wrong is wrong regardless of sign-off (`references/review.md`).
- Commit messages, PR title/body, and code comments are always professional prose.
- Delegate to the skills; lean on each as-is.
- Restate the intent and confirm before changing scope.
- Claim a phase done only with artifact proof - a runbook result envelope (JSON), a PR URL,
  a file path, or pasted command output. Treat a delegated/background skill's empty output as a
  failure to surface.
