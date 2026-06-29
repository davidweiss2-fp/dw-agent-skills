# Promoting a method into a runbook (the Warm → Hot step)

Run this when a `dw-knowledge` how-to exists for a recurring workflow but no runbook does yet. The
skill scaffolds deterministically; you fill only the judgment (the shell body); the self-test
gates acceptance.

## Steps

1. **Recall the method.** Pull the `dw-knowledge` how-to (its steps, the container/command, how it
   isolates — copy diff? checkout commit? worktree?). That prose is the spec.
2. **Pick scope + isolation.** Project store unless the flow is repo-agnostic. `worktree` unless
   the tool is pinned to the main checkout (Docker mount, a DB on the repo path) → `shared-dir`.
3. **Scaffold.**
   ```
   node scripts/run.js scaffold <name> --isolation worktree|shared-dir [--scope global|project]
   # flow:  node scripts/run.js scaffold <name> --flow
   ```
   This writes `manifest.json` + a `command.sh` stub with the runner/lock/report already wired.
4. **Fill `command.sh`** with the one tool call from the method (use `$RUNBOOK_WORKDIR`,
   `docker exec …` for container-bound checks). Factor any reusable setup/cleanup into
   `_lib/setups/` and `_lib/cleanups/` and list them in the manifest. Set `manifest.report` so
   `summary`/`findings` are meaningful. Add `triggers` if the hint hook should catch hand-runs.
5. **Set `ref`.** `HEAD` for "current commit", `merge-base:main` for "diff vs master",
   `working` for "my uncommitted changes" (`shared-dir` only).
6. **Self-test until pristine.** Run it (`node scripts/run.js <name> --scope …`). Confirm:
   `status` is right, `summary`/`findings` parse, and for `shared-dir` that **`pristine` is
   `true`**. If a `shared-dir` run reports `error`/`pristine:false`, the cleanups don't restore the
   tree — fix them; do not weaken the guard. Re-run until clean.
7. **Link the memory.** Update the `dw-knowledge` how-to (via that skill) with a pointer:
   `Runbook: node scripts/run.js <name> --scope <scope>` so the next agent jumps straight to Hot.
8. **Verify-on-use thereafter.** Each successful Hot run is a signal to bump the memory's
   confidence; a failure that turns out to be the runbook's fault is a signal to fix it.

## Done when

- `node scripts/run.js <name>` returns a correct envelope, `shared-dir` runs are `pristine:true`,
  the reusable parts live in `_lib/`, and the memory points at the runbook.
