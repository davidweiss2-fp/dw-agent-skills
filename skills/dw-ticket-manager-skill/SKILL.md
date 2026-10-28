---
name: dw-ticket-manager-skill
description: Run an accepted set of settled Jira tickets across the repos they touch until draft PRs exist or you stop; invoke /dw-ticket-manager [starting ticket key].
disable-model-invocation: true
---

# Ticket manager: settled Jira set to draft PRs

Run when product decisions are **already settled** and the code surface is wide. This skill
does **not** open an up-front product grill — use `dw-grilling-skill` (`/dw-grill`) when the
plan still has real forks.

## Role and state

**Role:** Drive an accepted set of Jira tickets across every repo they touch.

**State this skill owns:** only the **accepted ticket set** (in/out split after human accept).
Jira supplies links and ticket text. The run reads that set until each in-scope repo has a
draft PR URL or a recorded stop reason, or the user stops.

**Execution model:** Repo edits are **Task** subagents only — `subagent_type: generalPurpose`,
`model: composer-2.5`. The parent orchestrates; it does **not** edit product code. **One
worktree per repo** (via `dw-git-ops-skill`). **Draft PRs** go through `dw-git-ops-skill`
(`/dw-git-ops`). Show Jira comments for approval before posting. The agent does **not** merge.

## Invocation

`/dw-ticket-manager <starting ticket key>`

Example placeholder only: `/dw-ticket-manager RD-1`

## Issue-link types (closed set — in by default)

These link types start **in** the accepted set until the user moves them out:

- parent
- child
- epic
- the "blocks" link type (Jira Blocks)

Every other link type starts **out** until the user moves it in. No script encodes this list —
this section is the only source of truth.

## Steps

1. **Starting key.** Require exactly one Jira ticket key from the invocation (not zero, not
   several). *Done when:* exactly one key is recorded for the run.

2. **List links.** Read that ticket's Jira issue links — type and key for every link. *Done
   when:* every link is listed, or the ticket has zero links and that is stated.

3. **Split.** Apply the closed in-set above; everything else starts out. Show **In** and **Out**
   lists. The user may move keys either way before accepting. Do not edit any repo file in this
   step. *Done when:* both lists are on screen and no repo file has been edited.

   | Excuse | Reality |
   |---|---|
   | "The split is obvious, start the repos" | Repo work before an unconditional accept is the failure this skill exists to prevent. |
   | "A weaker link is probably in" | Only parent, child, epic, and Blocks start in. Any other type starts out until the user moves it. |

4. **Accept.** Wait for an **unconditional** accept of one set (the in list as adjusted). A
   conditional accept ("yes if…", "probably") is not done — clarify or wait. *Done when:* the
   accepted set is explicit (keys listed).

5. **Repos per ticket.** For each accepted ticket, name the repo(s) it touches (from ticket,
   links, and codebase as needed). *Done when:* each accepted ticket has a repo list or an
   explicit **none**.

6. **Work.** For each in-scope repo: one composer-2.5 Task for that repo's tickets, a dedicated
   worktree, implementation through the Task, then a **draft** PR via `dw-git-ops-skill`. *Done
   when:* every in-scope repo has a draft PR URL or a recorded reason work stopped there.

7. **Mid-run product fork.** If a **real product decision** appears during step 6, ask **exactly
   one** question — same discipline as `dw-grilling-skill` (one question, recommended default,
   wait; see that skill's `references/asking-well.md` — do not copy its full loop). Then
   continue this run; this is not an up-front grill. *Done when:* that answer is locked and step
   6 has resumed.

   | Excuse | Reality |
   |---|---|
   | "This fork is small, pick it" | A product decision mid-run is one question to the user, then the run continues. |

## Related skills (pointers only)

- **`dw-git-ops-skill`** — worktrees, commit/push, draft PR (`/dw-git-ops`).
- **`dw-grilling-skill`** — up-front grill or reference for the one-question mid-run shape
  (`/dw-grill`); not the default entry for this skill.
- Jira read tools — read issues, links, and draft comments (show before post).
