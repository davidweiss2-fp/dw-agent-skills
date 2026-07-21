---
name: dw-git-ops
description: Run a git operation through the suite's git owner (worktree-first flow + destructive-op judgment).
---

# /dw-git-ops

Do git through the one owner instead of hand-rolling commands. Worktree-first — one worktree =
one branch = one scope = one PR, reaped on merge. Everyday git is `scripts/ops.sh`; destructive
git is run raw under the judgment rubric in `SKILL.md`.

## Invocation

`/dw-git-ops [what you want to do]` — e.g. "start RD-1234 cars", "ship this as a draft PR",
"clean up merged worktrees", "I think I need to reset --hard".

## Flow

1. **Read `SKILL.md`** for the model, the command surface, and the destructive-op rubric.
2. **Map the request to a command:**
   - new work → `ops.sh branch --scope <s> (--ticket <T> | --unplanned) [--base <ref>]`, then
     cd into the printed worktree path.
   - commit/push → `ops.sh add` / `commit` / `push`, or `cap` for all three.
   - PR → `ops.sh pr --title <t> --body <b> [--ready]`; flip later with `pr-ready` / `pr-draft`.
   - cleanup → `ops.sh worktree-rm <path|branch>` (one) or `ops.sh reap` (all merged).
   - state → `ops.sh status`.
3. **Destructive request → judge it, run it raw.** Confirm it's the right call, can't be safely
   avoided, and name what's lost (rubric in `SKILL.md`); then run the raw git command and let the
   permission prompt be the human's gate. Explain why in your message, and run it as-is so the
   prompt fires.
4. **Hand off** an ongoing keep-green PR to `dw-pr-ready`; run checks via `dw-runbook`
   (`preflight`/`fmt`) — this skill owns git, not checks.

## Hard rules

- Worktree-first; root needs `--root`.
- Destructive git is judged and run raw - the prompt is the gate, left to fire.
- Extend the flow - add to `ops.sh`.
