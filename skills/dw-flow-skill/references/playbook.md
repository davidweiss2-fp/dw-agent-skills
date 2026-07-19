# Per-phase playbook

The spine in `SKILL.md` is the map; this is how each phase runs and when it is done. Phases are
the default — reorder or skip per the task. Only the four gates (🚪) stop the flow.

**Every phase opens with a skill survey** — before doing the phase's work, survey the in-scope
skills and pick the ones that are a genuinely good call for *this* phase, then narrate what you
use (details under "Skill discovery" at the end). The skill you invoke is the evidence.

## 1. Ground

Recall `dw-knowledge` first — preferences, prior decisions, already-gathered context — before any
fresh searching or asking. Derive the ticket from the branch (`{ticket}-{context}`) and gather its
context; if resuming, read `~/Documents/dw-agent-store/run-notes/<project-slug>/` first. Then recommend an
approach rather than presenting a blank slate.

For **bug tasks**: search the APM (Coralogix) for the real error / stack trace before forming any
hypothesis. If no trace is found there, ask the dev for the specific trace. Never reason from a
guessed location.

Surface any clear, non-trivial product/UX call here via `dw-team-communication` (drafts only).

*Done when:* knowledge recalled, ticket context in hand, a recommended approach posted in the chat
(and, for bugs, a trace-backed cause located or explicitly requested from the dev).

## 2. 🚪 Grill

**Invoke `dw-grilling`** and hand fully into it — don't reimplement its loop in the conductor.
Its interview runs inline as plain chat text: one question at a time, each led by a recommended
default, never through a picker/question tool. Let it run uninterrupted — keep flow's own
narration, data, and plans out until the grill is done (`dw-grilling` holds context to the end).
*Done when:* the resolved-design summary has no material open decision.

## 3. Simplify the plan

Run `/simplify` on the drafted plan before it reaches the gate — cut steps, files, and scope the
change does not need; a smaller plan is a smaller diff. *Done when:* the simplify pass is applied
and the trimmed plan is what goes to the gate.

## 4. 🚪 Plan

Present the resolved-design summary as the plan and get approval before any code. Confirm the
root cause here for bug tasks. **Lock the success metric** — the metric or query that will show
the change worked in prod, its expected direction/threshold, and the observation window — so
post-merge verification cannot retrofit it later. Suggest a knowledge capture of any durable
decision. Write the approved plan **and the success metric** to the worktree context dir. *Done
when:* the dev approves and both the plan and the metric are written to the worktree context dir.

## 5. Implement

Build to the approved plan — minimal diff, no churn. Scope discipline: touch only the files the
task names, confirm before expanding scope, and preserve TODO/context comments. Auto-fix
behavior-preserving lint/test failures. If a clear product/UX call appears mid-build, surface it
via `dw-team-communication` and keep going where you can. *Done when:* the diff implements the
plan and behavior-preserving checks pass.

## 6. Simplify the diff

Run `/simplify` on the diff before deslop — collapse needless indirection and dead scope while
the change is fresh. *Done when:* the simplify pass is applied (or it reports nothing to cut).

## 7. Deslop

Run `dw-deslop` on the branch diff. *Done when:* `dw-deslop`'s strip summary is posted and the
diff still behaves.

## 8. Review

Run `/code-review` (or `fp-cdp-review` in that scope). Re-check the regressions that bite late:
permission/RBAC gating, namespace/constant collisions, duplicate imports. Surface any product/UX
call that review exposes via `dw-team-communication`. *Done when:* the review's findings are
posted and triaged, and the blocking ones fixed.

## 9. Verify *(offered)*

Offer to run the app / the `verify` skill when the change is runnable and worth it; skip otherwise
and say so.

Before shipping, run the mandatory preflight regardless of whether the offered `verify` run
happens: recall `dw-knowledge` for the repo's verify recipe (which runbook, how it runs, what it
tolerates) rather than re-deriving or asking; run the repo's lint/typecheck/test on the diff via
`dw-runbook`; then `fmt` the diff and fold the resulting `fmt` patch into the commit. *Done when:*
the dev declines the offered `verify` run (or behavior is confirmed against a real run), **and**
the preflight's green result envelope (the JSON from `run.js`) is pasted, with `fmt` applied.

## 10. Simplify before ship

A final `/simplify` pass so the PR is the smallest correct change — the last chance to cut
before a reviewer reads it. *Done when:* the pass is applied (or reports nothing to cut).

## 11. Ship

If the change is large, propose a layer-split (keep PRs ~300 LOC, split beyond ~500) before
opening anything. Commit (professional message), push the `{ticket}-{context}` branch, open a
**draft** PR with a concise body. *Done when:* the draft PR's URL is posted.

## 12. 🚪 Post-PR

Present the draft PR for the dev to read, then ask whether to hand off to `dw-pr-ready`. *Done
when:* the dev decides.

## 13. Post-merge verify *(offered)*

Once the PR merges, offer `dw-post-merge-verification` — delegate to it, never wrap it. It reads
the plan-time success metric from the worktree context, verifies what it can locally, queries the
real signal through read-only observability tools, and rules the fix confirmed / no-effect /
inconclusive. *Done when:* the verdict is delivered or the dev declines.

## 14. Capture *(mandatory)*

Capture the generalizable method via `dw-knowledge` — especially the how-to-git / commands /
verify-ship flow worked out this task, which recurs every task and otherwise gets re-derived.
Auto-captured through the write gate, no confirm; never skipped. *Done when:* the capture is
written (file path shown) or the write gate's refusal reason is stated.

## Skill discovery, every step

At each phase, survey the in-scope skills and use the ones that are a genuinely good call —
narrate what you use, flag a notable skip in one line, never roll-call the survey, never hardcode
a list. The skill you invoke is itself the evidence the survey happened.
