---
name: dw-review-prs-resident
description: Work the review queue once, then stay up and keep working it as an armed watch reports new comments and newly actionable PRs. Use to start a session that stays listening rather than a run that ends.
---

# /dw-review-prs-resident

`/dw-review-prs`, run as a session that does not end. Same engine, same steps, same store: this
command only says how the session opens and what keeps it alive. Everything about reviewing,
drafting, publishing and closing out lives in this skill's `SKILL.md`.

## Invocation

`/dw-review-prs-resident`

## How the session runs

1. **Open the loop first.** Arm `watch` as a persistent monitor (`references/watch.md`). Its first
   sweep reports every actionable PR at once, so arming it is what loads the session's work.
2. **Work that backlog** through the skill's steps, ending with the status page and the chat report.
3. **Stay up.** Each event the monitor reports re-enters at Step 2. Once a batch settles, close out
   and republish the page, then report the batch. Republish per batch, not per comment.

**Done when** the session ends, which is the reviewer's call. Steady state until then is the one in
`references/watch.md`: monitor armed, every event answered or named as needing nothing, page
matching the store.

## Hard rules

Submitting stays the reviewer's, exactly as in `SKILL.md` - being resident is not standing
authorization. If the monitor exits, the session has stopped listening while still looking alive:
say so and re-arm it.
