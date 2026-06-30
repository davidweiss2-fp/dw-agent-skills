---
name: dw-runbook-skill
description: >-
  Memoize a recurring multi-step shell workflow into a saved "runbook" — one
  command that any agent runs once, cached and queued so parallel agents never
  collide, that cleans up after itself. Use when a workflow keeps getting
  re-derived ("run the ci/lint/test checks", "run lint on the diff vs master",
  "how do we run the tests here", "set up a runbook for X", "promote this to a
  runbook", "cache this workflow as a command", "do we have a runbook for Y"),
  or when several agents need to run checks against the same repo without
  stepping on each other. First time a workflow is met, do it and capture the
  method to dw-knowledge; once captured, promote it to a script. Backed by
  dw-knowledge; pairs with it (recall to find, capture to save).
---

# Runbooks: memoized, safe, queued workflows

A **runbook** turns a recurring shell workflow (CI, tests, typecheck, a deploy check) into a
single call with a **known compact result** — so agents stop spending tokens re-deriving "how do
I run X here" every session, and parallel agents never corrupt each other's working tree.

Every runbook is either a **command** (one atomic thing — `lint`, `typecheck`, `test`) or a
**flow** (a list of commands run in order — `ci = lint + typecheck + test`). Both are built and
run the same way. Variants (full vs. changed-files vs. diff-vs-master) are **separate runbooks**,
not flags.

The engine lives in this skill's `scripts/`; runbooks are **data** in a per-scope store. Run one:

```
node scripts/run.js <name> [--scope global|project] [--dry-run] [--json]
```

## The lifecycle — capture first, promote on recurrence

Drive recurring workflows through three states. Promotion is **lazy**: only script what recurs.

1. **Cold** (no runbook, maybe no memory) — do the workflow by hand. On success, offer a
   **`dw-knowledge` capture of the *method*** (prose). Do **not** script a one-off.
2. **Warm** (a `dw-knowledge` how-to exists, but no runbook) — this is the promote trigger.
   **Promote** it: `node scripts/run.js scaffold <name>` lays down the folder + manifest + a
   `command.sh` stub with the runner/lock/report already wired; **you fill only the shell body**
   from the memory's method; then **self-test** until the working tree is left pristine; then
   update the memory to point at `node scripts/run.js <name>`. Full steps:
   `references/promote-workflow.md`.
3. **Hot** (a runbook exists) — just **run it**. One call, compact envelope. On success, bump the
   memory's confidence (verify-on-use, via `dw-knowledge`).

Recall `dw-knowledge` before assuming the state — a method or a runbook may already exist.

## Anatomy of a runbook

```
<store>/<name>/manifest.json   # isolation, ref, setups[], cleanups[], report, triggers
<store>/<name>/command.sh      # the ONE atomic thing (a flow has steps[] instead)
<store>/_lib/setups/<n>.sh     # reusable setup, edited ONCE, referenced by name
<store>/_lib/cleanups/<n>.sh   # reusable cleanup
```

`command.sh` runs with `cwd=$RUNBOOK_WORKDIR` and env `RUNBOOK_REPO`, `RUNBOOK_REF`,
`RUNBOOK_RESOURCE`, `RUNBOOK_ISOLATION`, `RUNBOOK_LOG`, and `RUNBOOK_ARGS` (optional positional args
from the CLI, space-joined). It owns the actual tool call — including a `docker exec <container> …`
when the check runs inside a container. A command may read `RUNBOOK_ARGS` to override its default
scope — e.g. `run.js lint app/Foo.php` checks one file; the args are folded into the cache
signature, so a parametrized run never collides with (or is served the cache of) the default-scope
run. Full manifest reference and the shared-setup model: `references/layout.md`.

## Safety: isolation + the queue (why runs never collide)

Each command declares an **isolation mode**:

- **`worktree`** (default) — the runner adds a throwaway `git worktree` at a committed ref, runs
  there, removes it. Each run owns its dir, so different runs are **inherently parallel-safe** and
  take no lock. Needs a committed ref (`HEAD`, `merge-base:main`), not the dirty working tree.
- **`shared-dir`** — for tools pinned to the main checkout (e.g. a Docker mount like
  `<your-container>`). The runner can't use a separate path, so these **serialize** through a
  file-based lock and the run is bracketed by a **pristine guarantee**: it snapshots `HEAD` +
  working tree before, and after cleanup asserts they're unchanged — drift is reported as an
  `error`, never silently left behind.
- **Mutating ("fixer") commands** (e.g. a formatter) keep that pristine guarantee with **no special
  flag**: the command does its work in the main checkout, captures the resulting diff to a **patch
  artifact**, then restores the checkout to its exact prior bytes — so by the time the runner
  checks, the tree is unchanged and `pristine` holds naturally. The fix is delivered as the patch
  (the ship/amend step applies it). Where it ran, and the capture/restore, stay invisible to the
  caller — it just runs `run.js <fixer>` and reads the result.

The lock is a **single-flight coordinator**, not just a mutex: identical in-flight runs (same
signature) **coalesce** onto one execution and share its result; a recently-cached result is
reused outright. So N agents asking for the same check pay for **one** run. Mutex keys on the
resource; coalesce keys on the run signature `(command, ref, file-versions, args)`. Atomicity is
`mkdir`-based (cross-platform; macOS has no `flock(1)`); crashed holders are reclaimed by
PID-liveness + a staleness backstop. Design + proof: `references/lock-design.md`.

## The result envelope

A run prints a **compact JSON envelope**, with full output spilled to a log file referenced by
path — the token-savings lever. Up to **10 parsed `findings`** (the actual errors/failing tests)
are inlined so the agent can act on a small failure set without ever opening the log:

```json
{ "command":"test","status":"pass|fail|error","exitCode":0,"cached":false,
  "isolation":"shared-dir","durationMs":41200,"summary":"212 passed, 0 failed",
  "findings":[],"findingsTruncated":false,"pristine":true,"log":"<path>" }
```

`cached:true` on a coalesce/cache hit. Per-command parsers live in the manifest's `report`.
Details: `references/reporting.md`.

## Storage (two-tier, mirrors dw-knowledge)

- **Global / user-level / repo-agnostic** → `~/.claude/knowledge/runbooks/` (`--scope global`).
- **Repo-specific** → `~/.claude/projects/<slug>/runbooks/` (`--scope project`, the default).

Decide at promote time; default project, go global when the flow doesn't depend on one repo.

## Optional hint hook

`scripts/dw-runbook-hint.js` is an **advisory** PreToolUse(Bash) hook: when an agent is about to
hand-run a command that a runbook's `triggers` cover, it nudges "run the runbook instead." It
never blocks. Wiring snippet: `references/hook.md`.

## Hard rules

- **Capture before scripting; promote only on recurrence.** No runbook for a one-off.
- **A `shared-dir` run must leave the checkout pristine** — the runner enforces it; never weaken
  the check or auto-`reset` to force it.
- **One command = one reason.** Don't fold unrelated checks into one `command.sh`; compose a flow.
- **Engine is shared; runbooks are data.** Don't copy `run.js`/`lock.js` into a store.
- **Memory only via `dw-knowledge`** — store the method, never secrets; the runbook points back.
- **Variants are separate runbooks** (params allowed, not the default).
