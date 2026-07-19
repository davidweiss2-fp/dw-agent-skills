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
  that skill wins — this one does not wrap it.
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
  skill wins; do not wrap it in the conductor.

## How to talk

| Context | Mode |
|---|---|
| thinking / model-facing (reasoning, subagents, internal narration) | caveman **ultra** |
| talking to the dev | caveman **full** |
| commit messages, PR title/body, `dw-team-communication` drafts, code comments | **no caveman** — professional prose, always |

Caveman = compressed: drop articles, filler, hedging, tool-call narration; keep code blocks,
exact error strings, and function/API names intact; fragment pattern; revert to normal phrasing
for security warnings, irreversible actions, or ambiguous multi-step sequences; never announce
the mode. Full spec and the mode mapping: `references/communication.md`.

## The four gates — the only stops

1. 🚪 **Intent** — restate the ask in expanded form (clear wording, fixed grammar/spelling, an
   explicit call-to-action) plus a one-line **desired output**, then confirm. Fire on a new task
   or a scope change, **or any message over 20 words**; skip trivial steering replies (one-word
   answers, "go", redirects). On a model-invoke, this gate also carries the engage y/n.
2. 🚪 **Grill** — **invoke `dw-grilling`** and hand fully into it; let its inline text
   interview run to completion before moving on.
3. 🚪 **Plan** — approve the resolved-design summary before any code; lock the **success
   metric** (how we'll know it worked in prod) here too.
4. 🚪 **Post-PR** — present the draft PR; the dev decides whether to hand off to `dw-pr-ready`.

Between gates the conductor runs autonomously and is interruptible — redirect any time.

## The spine (default, adaptive)

Default order; reorder or skip per task. Each step names the skill it leans on. Full per-phase
playbook with completion criteria: `references/playbook.md`.

Open every phase by surveying the in-scope skills for *that* phase (see Skill discovery below).

1. **Ground** — recall `dw-knowledge`; gather codebase + ticket context (derive the ticket from
   the branch); recommend an approach. Bug tasks: establish root cause (below).
2. 🚪 **Grill** — **invoke `dw-grilling`** (don't reimplement it); hand fully in and let its
   inline text interview run uninterrupted to completion.
3. **Simplify the plan** — `/simplify` the drafted plan before it goes to the gate; cut steps and
   scope the change doesn't need.
4. 🚪 **Plan** — resolved-design summary → approve; lock the **success metric** (metric/query +
   expected direction) and write it, with the plan, to the worktree context. Suggest a capture.
5. **Implement**.
6. **Simplify the diff** — `/simplify` the diff, then hand to Deslop.
7. **Deslop** — `dw-deslop` the diff.
8. **Review** — `/code-review` (or `fp-cdp-review` in that scope).
9. **Verify** *(offered)* — `verify` the app for behavior; and before shipping run the repo's
   **preflight checks** via `dw-runbook` (lint/typecheck/test on the diff) and `fmt` the diff,
   folding the `fmt` patch into the commit; the proof of a green preflight is the result
   envelope from `run.js`, not a bare claim. Recall `dw-knowledge` for the repo's verify recipe
   (which runbook, how it runs, what it tolerates) rather than re-deriving or asking.
10. **Simplify before ship** — a final `/simplify` pass so the PR is the smallest correct change.
11. **Ship** — propose a layer-split if large; preflight green + `fmt` applied → ship via
    **dw-git-ops** (`ops.sh cap "<message>"` then `ops.sh pr --title "<t>" --body "<b>"` — draft is
    the default, add `--ready` only when shipping ready; worktree-first — never hand-roll git).
12. 🚪 **Post-PR** — keep-ready? → `dw-pr-ready`.
13. **Post-merge verify** *(offered)* — once the PR merges, delegate to
    `dw-post-merge-verification`; it reads the plan-time success metric from the worktree context
    and rules the fix confirmed / no-effect / inconclusive.
14. **Capture** *(mandatory)* — `dw-knowledge`; especially the **how-to-git / commands /
    verify-ship flow** you worked out this task (these recur every task and stop the next agent
    re-deriving or asking). Auto-captured through the write gate, no confirm; never skipped.

## Skill discovery (every step)

Survey the skills available in the current scope and pick only the ones that are a genuinely good
call for the step — judgment, not mere relevance. Use them and **narrate what you use** ("running
`dw-deslop` on the diff"); no confirmation. Flag a **notable skip** in one line ("skipping
`verify` — nothing runnable here"); never roll-call the whole survey. No hardcoded skill list —
search live so it stays current as the skill set changes.

## Root cause (bug tasks)

No edits before an approved, evidence-backed cause. Search our APM (Coralogix) for the real
error / stack trace. If no trace is found there, **ask the dev for the specific error trace** —
do not guess a location. Confirm the cause at the Plan gate.

## Product / UX calls

When a clear, non-trivial product or UI/UX decision is missing, surface it via
`dw-team-communication` (drafts only, never posts) at three points: **Ground**, **after the plan
during Implement**, and **Review**. Skip the trivial or obvious calls.

## Operating principles

Canonical source is `dw-knowledge`'s `david-working-rules` — on any divergence it wins; update there.

- Recall knowledge before starting any task.
- Guard the code: push back on hacks and recommend the better approach.
- Gather context and recommend an approach before asking.
- Only touch files the task names; confirm before expanding scope; preserve TODO/context comments.
- No product UI/UX change without approval.
- Auto-fix lint/test failures that do not change behavior.
- Keep PRs small and reviewable; slice by layer (~300 LOC, split beyond ~500).
- Branch `{ticket}-{context}`; in the plan phase, derive the ticket from the branch.
- Worktree per ticket: persist to `~/Documents/dw-agent-store/run-notes/<project-slug>/` and read it first.
- Skill overlap → the `dw-` skill wins.
- Memory only via `dw-knowledge` (global store `~/Documents/dw-agent-store/knowledge/`); never native per-project memory.
- Comments describe what/how, never why.

## State / resume

At each gate, write a few lines to the worktree context dir — current phase, the approved plan,
gate decisions. On resume, read it first and re-enter at that phase. Full session handoff →
`dw-handoff`.

## Hard rules

- Only the four gates stop the flow; everything else runs and stays interruptible.
- At the Grill gate, **invoke `dw-grilling`** and hand fully into it — inline chat text, one
  question at a time, uninterrupted. Never pose grill questions through a picker and never inject
  flow narration, data, or plans between them (`dw-grilling` holds context to the end).
- Never edit on a guessed cause — prove it (APM or ask the dev) first.
- Artifacts (commit / PR / team-communication drafts) are never caveman.
- Delegate to the skills; never reimplement them.
- Never silently change scope — restate the intent and confirm.
- Never claim a phase done without artifact proof - a runbook result envelope (JSON), a PR URL,
  a file path, or pasted command output. A delegated/background skill returning empty output is
  a failure to surface, not a pass.
