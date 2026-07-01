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

Full loop, taxonomy, and KEEP discipline: this skill's `SKILL.md` and `references/`.
