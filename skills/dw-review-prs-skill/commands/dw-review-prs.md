---
name: dw-review-prs
description: Review the PRs waiting on you and leave the findings as an unsubmitted [dev-review-ai] review.
---

# /dw-review-prs

Draft the reviews waiting on you. Reads your review queue, reads what you and everyone else already
said on each PR, then leaves each finding as a **pending (unsubmitted)** `[dev-review-ai]` comment for you
to read in the GitHub UI and submit yourself.

## Invocation

`/dw-review-prs [PR URL or nothing]`

- With nothing: work the whole queue of open review requests, actionable PRs first.
- With a PR URL: that PR only, same steps.

## Hard rules

Submitting is yours — the skill never publishes a review without an explicit instruction naming the
event. Every draft carries the `[dev-review-ai]` tag. A PR whose head SHA is already recorded in the store
is not reviewed again. Full engine: this skill's `SKILL.md`.
