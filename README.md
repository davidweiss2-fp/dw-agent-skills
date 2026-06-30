# dw-agent-skills

David Weiss agent skills — installable for **Cursor** and **Claude Code**.

## Install

```bash
# Everywhere — Claude Code (plugin) + every other agent (Cursor, Codex, Windsurf, …) via the skills CLI
npx -y github:davidweiss2-fp/dw-agent-skills

# Just the non-Claude agents
npx -y github:davidweiss2-fp/dw-agent-skills -- --only agents

# Just Claude Code
npx -y github:davidweiss2-fp/dw-agent-skills -- --only claude
```

Or one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/davidweiss2-fp/dw-agent-skills/main/install.sh | bash
```

See [INSTALL.md](INSTALL.md) for details.

## Skills

| Skill | Trigger | What |
|-------|---------|------|
| `dw-flow-skill` | `/dw-flow [task]` / "run the flow" / "take RD-1234 to a PR" | Adaptive conductor — drives a substantial task from understanding to a merge-ready PR (ground, grill, plan, implement, deslop, review, ship), delegating to the other `dw-*` skills and surveying in-scope skills; pauses only at 4 gates (intent / grill / plan / post-PR); caveman by default |
| `dw-pr-ready-skill` | Full PR URL + "keep ready" / babysit | Watches comments, CI, review/draft state, merge queue; updates branch when safe; exits with next action |
| `dw-product-decision-skill` | "ask product about this" / `/dw-product-decision [slack\|jira\|both]` | Reframes a dev question into a product-level decision and drafts a Slack DM + JIRA comment (drafts only, never posts) |
| `dw-knowledge-skill` | "how do we run X here" / "remember this" / `/dw-recall` / `/dw-remember` | Live cross-project agent memory — recall before non-trivial work, capture verified+generalizable knowledge, self-update and prune; stores the method never secrets, confirms before writing |
| `dw-skill-authoring-skill` | "help me write a skill" / "review this skill" / "why won't my skill trigger" | Principles, a checklist, and a failure-mode table for authoring reliable, well-triggered Agent Skills (naming, description, progressive disclosure, scripts-vs-prose). Invoked by name |
| `dw-handoff-skill` | "write a handoff" / "hand this off" / `/dw-handoff [focus]` | Compresses the session into a self-contained, secret-scrubbed handoff doc (state, next steps, suggested next skills) in the temp dir; redaction delegated to `km-scrub` |
| `dw-grilling-skill` | "grill me on this" / "stress-test this plan" / `/dw-grill [topic]` | Interview engine — resolves a plan's open decisions one question at a time, each led by a recommended default, ending in a resolved-design summary |
| `dw-git-ops-skill` | "commit/push/branch/PR" / "ship this" / `/dw-git-ops [task]` | The suite's single git owner — worktree-first flow (`branch`→worktree, `add`/`commit`/`push`/`cap`, `pr`/`pr-ready`/`pr-draft`, `worktree-rm`, `reap`; one worktree = one branch = one scope = one PR, reaped on merge) via `ops.sh`; destructive git (`reset --hard`, force-push, `clean -f`, `branch -D`) is run raw under a judgment rubric, not blocked |
| `dw-deslop-skill` | "deslop this" / "remove the AI slop" / `/dw-deslop [path\|--staged]` | Strips AI slop (code + prose) from the branch diff — over-commenting, defensive boilerplate, `any`-casts, dead code, needless abstraction, puffery, emoji bullets — behavior-preserving, keeping legitimate code/comments at trust boundaries |
| `dw-runbook-skill` | "run the ci/test runbook" / "cache this workflow" / "promote this to a runbook" / `/dw-runbook` | Memoizes a recurring shell workflow into one cached, queued, self-cleaning command; first run captures the method to `dw-knowledge`, then promotes it to a script; `worktree`/`shared-dir` isolation with a file-based single-flight lock so parallel agents never collide |

## Usage — dw-pr-ready-skill

Attach or invoke the skill with a full PR link:

```
https://github.com/org/repo/pull/123
```

The skill runs `node scripts/dw-pr-ready-watch.js "<url>"` and loops until the PR needs attention or is ready.

## Usage — dw-product-decision-skill

Invoke when an engineering question needs a product call:

```
/dw-product-decision [slack|jira|both] [optional topic]
```

It reframes the question to product altitude (Context / Scenario / Question / Suggested resolution),
derives the JIRA ticket from the branch, optionally attaches app screenshots (staging or local) for
UI questions, and outputs copy-ready Slack-DM and JIRA-comment drafts with click-to-open links. It
never posts — you paste.

## Usage — dw-knowledge-skill

A live, file-based agent memory that travels across sessions and projects. Recall before
non-trivial work; capture what worked.

```
/dw-recall [query]      # surface saved knowledge that may apply (advisory, read-only)
/dw-remember [what]     # capture a verified, generalizable fact or procedure
```

It recalls (`node scripts/km-recall.js <query>`), ranks hits by relevance × recency ×
confidence, and treats them as advisory — verify before relying. Capture runs a gate →
genericize → scrub → dedup → confirm → write+index flow, storing the **method, never
secrets**, and never writes without your confirmation. Memories live globally in
`~/.claude/knowledge/` or project-locally in `~/.claude/projects/<slug>/memory/`. An
optional `UserPromptSubmit` hook can auto-recall on each prompt — see
`skills/dw-knowledge-skill/references/recall-hook.md`.

## CI

[`.github/workflows/verify.yml`](.github/workflows/verify.yml) runs on every push and pull
request to `main` (syntax check → unit tests → git-ops self-test → packaging smoke). You
can also run the same job locally with [`act`](https://github.com/nektos/act), which executes
the workflow inside Docker exactly as GitHub Actions would — useful for checking a change
before pushing.

```bash
# one-time (needs Docker running)
brew install act

# run the `verify` job
act push -j verify -e .github/act-event.json
```

Why the flags:

- The workflow only triggers on push/PR to `main`, so [`.github/act-event.json`](.github/act-event.json)
  pins the event ref to `main` — otherwise `act` skips the job on a feature branch.
- [`.actrc`](.actrc) pins the runner image (`catthehacker/ubuntu:act-latest`) so the first
  run doesn't prompt for an image size.
- On Apple Silicon, if a step hits an architecture issue, append
  `--container-architecture linux/amd64`.

## License

Copyright (c) 2026 David Weiss. All Rights Reserved. See [LICENSE](LICENSE).

Some skills are derived from MIT-licensed projects; their upstream notices are
reproduced in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
