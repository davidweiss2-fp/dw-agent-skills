---
name: dw-pr-ready-skill
description: >-
  Keep a single GitHub pull request ready for review by watching comments, CI,
  review state, draft state, merge queue, and safe branch updates. Use when the
  user provides a full PR URL and asks to babysit, keep green, keep ready for
  review, or maintain a PR until mergeable.
---

# Keep PR Ready for Review

Your job is to keep one PR merge-ready. User gives a **full PR URL** (e.g. `https://github.com/org/repo/pull/123`).

## Start

From this skill directory, run the watcher. `--run` and `--branch-update` are **required** — the watcher exits non-zero with a usage error if either is missing or set to an unrecognized value:

```bash
node scripts/dw-pr-ready-watch.js "<full-pr-url>" --run watch-for-new --branch-update when-behind
```

One-shot (single poll, no loop):

```bash
node scripts/dw-pr-ready-watch.js "<full-pr-url>" --run get-all --branch-update when-behind
```

Dry poll without any branch update:

```bash
node scripts/dw-pr-ready-watch.js "<full-pr-url>" --run get-all --branch-update never
```

`--run` values:
- `get-all` — one full poll, then exit.
- `watch-for-new` — keep looping, polling for new events.

`--branch-update` values:
- `when-behind` — update the branch from base whenever it's behind.
- `on-conflicts` — update only when the PR is conflicting/not-mergeable.
- `never` — never update the branch.

Requirements: GitHub CLI installed and authenticated (`gh auth status`).

Directive author: comments from the gh-authenticated user are treated as agent directives.
Override with `DW_PR_DIRECTIVE_LOGINS` (comma-separated logins) to widen or change the set.

## When watcher exits

Read stdout and the `artifact` JSON path. Act on `reason`:

| reason | Action |
|--------|--------|
| `new-comment` / `user-directive` | Triage unresolved threads. Fix valid issues. Reply `[DEV-AI]`. Resolve threads when done. |
| `ci-failure` | Fix scoped CI failures. Keep every CI check as strict as it is. Push fixes. **Drift-capture** (below) if CI caught something local preflight missed. Re-run watcher. |
| `merge-conflict` | Resolve conflicts in a worktree. Preserve branch intent. Push. Re-run watcher. |
| `update-branch-failed` | Inspect `updateError`. May need manual merge from base. |
| `waiting-review` | Leave the branch as-is. Wait for reviewer. |
| `waiting-draft` | Resolve comments only, leaving the branch as-is. Mark ready when user wants. |
| `waiting-checks` | CI still running. `watch-for-new` keeps polling automatically; with `--run get-all`, re-run when checks finish. |
| `pr-ready` | PR green and triaged. Report status. |
| `auth-api-failed` | Fix `gh auth`. |

## Branch update rules (watcher enforces)

- **Draft PR** — no base update; comments only.
- **Review required / changes requested** — no base update until review clears.
- **Merge queue enabled** on repo/base — no base update.
- **Otherwise** — update from base per `--branch-update`: `when-behind` updates whenever the branch
  is behind base (`updatePullRequestBranch`); `on-conflicts` updates only when the PR is
  conflicting/not-mergeable; `never` never updates.

## Agent work loop

1. Run watcher.
2. If interrupt (exit 2): fix issue, push if needed, run watcher again.
3. If `pr-ready` / `waiting-*` (exit 0): report and stop unless user wants continued watch.
4. Repeat until merged or user stops.

## CI-drift capture (close the local↔CI gap)

When CI fails something local `preflight` passed — or never ran, e.g. a test covering a *changed
source* file that wasn't selected — feed the lesson back via `dw-knowledge` so it's caught locally
next time:

- **Coverage-ADDING** (map a source file to the test CI ran, broaden a check's scope, add a parser
  rule) — **auto-apply**: append it to the repo's source→test map and note the CI run. These can
  only make local verify catch *more*.
- **Coverage-REDUCING** (remove a mapping, narrow scope, downgrade a command) - **propose first**
  and apply only after the user approves.

Recall the map before selecting tests; this loop is what grows it.

## Hard rules

- PR review comments from the directive author(s) (gh-authenticated user, or `DW_PR_DIRECTIVE_LOGINS`) = agent directives. Implement, push, reply `[DEV-AI]`, resolve thread.
- Filter noise bots (github-actions, codecov, dependabot). Act on Bugbot only when valid.
- Add new replies rather than editing existing PR comments.
- Merge the PR only when the user explicitly asks.
- Fix only failures in this PR's scope.
