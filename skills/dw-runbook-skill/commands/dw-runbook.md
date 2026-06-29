---
name: dw-runbook
description: Run, create, or promote a memoized workflow (a "runbook") — one cached, queued, self-cleaning command.
---

# /dw-runbook

Turn a recurring multi-step shell workflow into a saved **runbook**: one command any agent runs
once, cached and queued so parallel agents don't collide, that restores the working tree after.

## Invocation

`/dw-runbook [name | promote <topic> | list]` — these are intents, not CLI subcommands; the
engine's only verbs are a bare `<name>`, `scaffold`, and `list`.

- **Run** a saved runbook → compact result envelope:
  `node scripts/run.js <name> [--scope global|project] [--dry-run] [--json]`
- **Promote** a recurring method → `node scripts/run.js scaffold <name>
  [--isolation worktree|shared-dir] [--flow] [--scope ...]`, fill its `command.sh` from the
  method, self-test until the checkout is left pristine, then point the `dw-knowledge` memory at it.
- **List** — `node scripts/run.js list [--scope ...]`.
- No arg — recall `dw-knowledge`; if a method exists but no runbook, offer to promote; if a
  runbook exists, run it; otherwise ask what workflow to memoize.

## Flow

1. **Recall** `dw-knowledge` for an existing method/runbook before doing anything.
2. **Cold** (nothing saved) → do it by hand → offer to capture the method (prose) to knowledge.
3. **Warm** (method, no runbook) → `scaffold`, fill the shell, **self-test pristine**, link memory.
4. **Hot** (runbook exists) → run it; on success bump the memory's confidence.

## Hard rules

- Capture before scripting; promote only on recurrence.
- A `shared-dir` run must leave the checkout pristine — never weaken the guard.
- One command = one reason; compose flows for the rest. Variants = separate runbooks.

Full engine, lifecycle, and references: this skill's `SKILL.md`.
