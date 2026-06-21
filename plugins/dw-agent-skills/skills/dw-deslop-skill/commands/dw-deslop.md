---
name: dw-deslop
description: Strip AI slop (code and prose) from the current branch's diff, behavior-preserving, keeping legitimate boundary code.
---

# /dw-deslop

Remove the AI slop the branch introduced — over-commenting, defensive boilerplate,
`any`-casts, dead code, needless abstraction, copy-paste, and prose tells (filler
openers, puffery, bold-everything, emoji bullets) — without changing behavior.
Prompt-driven; no scripts.

## Invocation

`/dw-deslop [optional path · or --staged]`

- No arg: the current branch's changes vs the base branch (default branch, usually
  `main`; fall back to `master` / `origin/HEAD`).
- A path: only the slop in those files.
- `--staged`: only staged changes.
- Nothing in scope: ask in one line what to deslop.

## Flow

1. Scope the diff — `git diff --merge-base <base>` (committed + working tree),
   `git diff --staged`, or the named paths. Touch only lines this branch introduced.
2. For each hunk ask *does this earn its keep?* and classify against the taxonomy
   (`references/code-slop.md`, `references/prose-slop.md`).
3. Strip surgically — remove/rewrite only the slop, match the file's conventions,
   never alter behavior or the actual feature/fix.
4. Hold the false-positive line — keep try/catch, guards, validation, and casts at
   trust boundaries; keep non-obvious what/how comments; judge prose by clusters,
   not single words. Flag genuinely ambiguous calls instead of guessing.
5. Verify — re-read the diff; run the repo's formatter/linter if it's cheap.
6. Summarize tersely — what was stripped by kind, plus anything left for a human.

## Hard rules

- Behavior-preserving above all; scope is the diff; codebase-first.
- Keep defensive code at the boundary, strip it only in the trusted interior.
- Comments: what/how, never why.
- Flag, don't guess. Terse output — no slop in the summary.

Full engine and taxonomy: this skill's `SKILL.md` and `references/`.
