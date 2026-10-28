---
name: dw-ticket-manager
description: Run a settled Jira ticket set across touched repos until draft PRs exist or you stop.
---

# /dw-ticket-manager

Drive an accepted set of settled Jira tickets across every repo they touch. Product decisions
are already made — no up-front grill. Parent orchestrates; repo edits are composer-2.5 Tasks;
draft PRs via dw-git-ops.

## Invocation

`/dw-ticket-manager <starting ticket key>`

Placeholder example: `/dw-ticket-manager RD-1`

## Flow

1. Record exactly one starting key from the invocation.
2. List all Jira issue links (type + key) on that ticket.
3. Split in/out (parent, child, epic, blocks start in); show both lists; user may move keys;
   wait for unconditional accept before any repo work.
4. Map repos per accepted ticket.
5. One Task per repo, one worktree per repo, draft PR per repo through `/dw-git-ops`.
6. Mid-run product fork → one question (dw-grilling shape), then continue.

Full rules, link-type closed set, and rationalizations: this skill's `SKILL.md`.
