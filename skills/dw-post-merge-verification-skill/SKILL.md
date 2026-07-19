---
name: dw-post-merge-verification-skill
description: >-
  Verify that a merged PR actually changed production behavior, instead of
  trusting green CI. Runs what it can verify locally, queries the success
  metric through read-only APM/analytics tools, hands the dev a pasteable
  checklist for what it cannot reach, then rules the fix confirmed, no-effect,
  or inconclusive against the metric fixed at plan time. Use after a merge -
  "verify the fix landed", "did the fix actually work in prod", "post-merge
  check", "check prod impact", or `/dw-post-merge [PR URL]`. Never touches
  production beyond read-only observability queries.
---

# dw-post-merge - prove the fix worked in prod

Green CI proves the code merged, not that it changed anything. A caching fix once shipped
green and moved the production metric by zero, discovered late. This skill closes that gap:
it observes the real signal after a merge and rules on it against a metric fixed **before**
the change, so the verdict can't be rationalized to whatever the data happens to show.

## Invocation

`/dw-post-merge [PR URL or the success metric]`

Runs after a PR merges. If invoked inside a `dw-flow` run, it is the offered post-merge step.

## The success metric (read first, never retrofit)

Read the metric from the flow's plan-time record: `~/Documents/dw-agent-store/run-notes/<project-slug>/`
(dw-flow's Plan gate writes it there). It states the metric or query, the expected direction
or threshold, and the observation window.

If no metric is recorded, **define it with the dev before any observation** - what number
moves, which way, over what window. *Done when:* the metric is stated in the session before a
single result is fetched. Never read the data first and then name the metric to fit it.

## Phase A - local verification (agent runs)

What can be checked without touching prod, checked first:

1. Run the `dw-env` preflight so the local env is sane (Docker, layout, creds shape).
2. Reproduce the pre-fix behavior locally where the change is reproducible; confirm the new
   behavior replaces it.
3. Run the repo's checks via `dw-runbook`; the result envelope (JSON) is the artifact proof.

*Done when:* local repro and checks are posted with their envelopes, or it is stated plainly
that the change is not locally reproducible and why.

## Phase B1 - prod observation, read-only (agent runs)

Query the success metric through the observability tools already connected: Coralogix
(DataPrime / PromQL), Mixpanel (reports, event trends). Templates: `references/checklist-templates.md`.

- **Allowed:** read-only queries through APM / analytics MCP tools only.
- **Forbidden:** browser automation, terminal / ssh / database routes into prod, any write or
  mutation, anything that changes production state.

*Done when:* the query and its fetched result are quoted in the session.

## Phase B2 - dev checklist (dev runs)

For what the agent cannot reach - dashboards, internal UIs, anything behind a login the tools
don't cover - produce a numbered, pasteable checklist. Each item names the **expected
observation**, not just "go look". The dev runs them and pastes results back.

*Done when:* the checklist is delivered and the dev's pasted results are in the session (or the
dev declines and that is recorded).

## Phase C - evaluate

Compare the evidence (agent-fetched + dev-pasted) to the metric. Rule:

- **confirmed** - the metric moved as predicted, within the window. Quote the evidence.
- **no-effect** - merged, but the metric did not move. Route back to `dw-flow`'s Ground phase:
  the real cause is still open. This is the exact failure this skill exists to catch.
- **inconclusive** - the window is too short, the signal too noisy, or evidence is missing.
  Name what observation would settle it.

Capture the verdict via `dw-knowledge` (method and outcome, never customer data).

*Done when:* a verdict with quoted evidence is posted, and on `no-effect` the hand-back to
Ground is stated.

## Hard rules

- Prod access is **read-only APM / analytics tools only** - never browser, terminal, ssh, or
  db routes, never a mutation.
- No verdict without evidence - agent-fetched or dev-pasted; never infer success from the merge.
- The metric is defined before evaluation, never retrofitted to the data observed.
- Never echo customer PII pulled from a query - aggregate or summarize (counts, rates), and
  say so.
