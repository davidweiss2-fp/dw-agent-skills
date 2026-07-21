---
name: dw-post-merge
description: Verify a merged PR actually changed production behavior against the success metric fixed at plan time.
---

# /dw-post-merge

Prove a merged fix worked in prod instead of trusting green CI. Reads the plan-time success
metric, verifies locally, queries the real signal through read-only observability tools, hands
the dev a checklist for what it can't reach, then rules confirmed / no-effect / inconclusive.

## Invocation

`/dw-post-merge [PR URL or the success metric]`

- With a PR URL: derive the ticket/branch and read the metric from the worktree context.
- With a metric: use it directly.
- With neither: define the metric with the dev before observing anything.

## Hard rules

Prod access is read-only APM / analytics tools only - every prod touch is a read through those
tools; browser, terminal, db routes, and mutations stay out of scope. Every verdict rests on
quoted evidence. The metric is fixed before evaluation and held fixed against the data. Full
engine: this skill's `SKILL.md`.
