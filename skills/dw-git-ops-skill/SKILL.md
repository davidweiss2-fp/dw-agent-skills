---
name: dw-git-ops-skill
description: >-
  The single git owner for the suite — the one place the commit / push / branch / PR flows
  live, so agents never hand-roll git or reinvent a "gitflow" script. Use whenever a task
  involves committing, pushing, creating a branch or worktree, opening a PR or flipping it
  draft↔ready, cleaning up finished worktrees, or ANY destructive git (reset, force-push,
  clean, branch delete). Worktree-first: one worktree = one branch = one scope = one PR,
  reaped when the PR merges. Everyday git runs through scripts/ops.sh; destructive git runs
  raw under the judgment rubric below. Reach for this for any git beyond a read-only
  status/log/diff, and prefer it over inventing your own git command sequences. Invoked as
  /dw-git-ops or whenever you ship work.
---

# dw-git-ops — the suite's git owner

One place for git, so behaviour is consistent and reviewable and nobody re-derives a branch/
commit/push/PR dance. The everyday, safe operations are a single script (`scripts/ops.sh`);
the **destructive** operations are deliberately *not* scripted — you run them raw, under
judgment, so the permission prompt stays the human's gate.

## The model: one worktree = one branch = one scope = one PR

Routine work happens in a **worktree**, not the root checkout. A worktree's scope must be
something **deliverable as a single PR** — all the work on it belongs to that one PR, and the
worktree is **reaped when the PR merges**. This is what makes parallel work safe: each ticket/
scope is isolated in its own checkout, so concurrent agents never step on each other, and
merged work is cleaned up automatically.

- **Branch from a worktree, not root.** `ops.sh branch` creates the worktree and prints its
  path; cd into that path and do the work there.
- **Root is the exception.** Operating on the primary checkout needs an explicit `--root`;
  otherwise mutating ops warn you to prefer a worktree (they still proceed — it's a nudge, not
  a wall).
- **Scope it to one PR.** If a task would sprawl across multiple PRs, that's multiple scopes →
  multiple worktrees.

## Commands — `scripts/ops.sh`

Run from this skill's directory; `ops.sh help` prints the full reference. Summary:

```
ops.sh branch --scope <s> (--ticket <T> | --unplanned) [--base <ref>]
        new worktree + branch {T}-{s} (or bare {s} when --unplanned); base defaults to the
        current HEAD, override with --base; prints the worktree path + reports the base used;
        opportunistically reaps already-merged worktrees first
ops.sh add <path>...      stage named paths (never `git add -A`)
ops.sh commit <message>   commit staged changes (guarded: not master/main, not detached)
ops.sh push               push -u the current branch
ops.sh cap <message> [<path>...]   add (if paths) + commit + push
ops.sh pr --title <t> --body <b> [--ready]   open a PR (draft unless --ready; title+body required)
ops.sh pr-ready / pr-draft   one-shot flip of the current branch's PR ready↔draft
ops.sh worktree-rm <path|branch>   remove a worktree (refuses if dirty; leaves the branch)
ops.sh reap               remove worktrees whose PR is MERGED + delete their local branch
ops.sh status             branch + short status + managed worktrees
```

Global `--root` opts into the primary checkout. Env: `OPS_DRY=1` (echo instead of run),
`OPS_NO_COAUTHOR=1`, `OPS_REMOTE=<name>`.

## Destructive git — judgment, not a script

`reset --hard`, `push --force` / `--force-with-lease`, `clean -f`/`-fd`, `branch -D`,
`checkout .` / `restore .`, `push --delete` are **not** in `ops.sh`. There is no hard block
either (this skill replaced the old blocking hook). Instead, before you run one, satisfy **all
three**:

1. **It's the right call for the goal** — not a shortcut around understanding what went wrong.
2. **It can't be safely avoided** — if a non-destructive path (a fresh `revert` commit, a new
   branch, `git stash`, committing then amending pre-push) loses nothing and isn't much more
   work, prefer it. Destructive is the last resort, not the first.
3. **You've named what's lost** — say out loud what the operation discards and why that's
   recoverable or worthless.

Then run the **raw git command** directly. It is intentionally un-allowlisted, so the
permission prompt fires — that prompt is the human's veto, and a feature, not an obstacle. In
your message, explain *why* this is the right destructive call so the human can decide fast.
**Never wrap the command to dodge the prompt.**

The one scripted deletion is `reap`, and only because a **MERGED** PR proves the work is
already safe in the base — so removing the worktree and its branch loses nothing.

## Boundaries (who owns what)

- **dw-pr-ready** owns the *ongoing* PR babysit (watch CI, review state, merge queue, keep
  green). `ops.sh pr` / `pr-ready` / `pr-draft` are *one-shot* state changes — create the PR,
  flip it once. Hand a PR you want kept-green to **dw-pr-ready**.
- **dw-runbook** owns *checks* (lint/typecheck/test, `preflight`, `fmt`). This skill owns
  *git*. A typical ship: `preflight` (dw-runbook) green → `fmt` → `ops.sh cap` → `ops.sh pr`.
- **dw-flow** is the conductor; its Ship step drives these.

## Hard rules

- **Worktree-first** — routine mutating work belongs in a worktree; root needs `--root`.
- **One worktree = one scope = one PR**, reaped on merge.
- **Never `git add -A`** — name the paths.
- **Destructive git is judged, run raw, and never prompt-dodged** — the prompt is the gate.
- **Don't reinvent the flow** — extend `ops.sh` rather than hand-rolling git sequences.
- **Commits/PRs are professional prose** — never caveman, no secrets in messages.
