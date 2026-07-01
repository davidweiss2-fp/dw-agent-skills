# Runbook anatomy & store layout

The engine (`scripts/run.js`, `scripts/lock.js`) ships with the skill and is shared. A **store**
holds only data:

```
<store>/
  <name>/manifest.json     # one folder per command or flow
  <name>/command.sh        # the atomic body (commands only)
  _lib/setups/<n>.sh       # reusable setup, edited once, referenced by name
  _lib/cleanups/<n>.sh     # reusable cleanup
  .locks/  .results/  .runs/  .worktrees/   # runtime (created on demand)
```

`<store>` is `~/.claude/knowledge/runbooks/` (global) or `~/.claude/projects/<slug>/runbooks/`
(project). The `<slug>` is the repo cwd with every non-alphanumeric char replaced by `-`.

## manifest.json — command

| field | meaning |
|---|---|
| `name` | runbook name (matches the folder). |
| `kind` | `"command"` (default) or `"flow"`. |
| `isolation` | `"worktree"` (default) or `"shared-dir"`. See `lock-design.md`. |
| `ref` | what the run targets: `"HEAD"`, `"merge-base:main"`, a sha/branch, or `"working"` (the dirty tree — **shared-dir only**; worktree mode needs a committed ref). Feeds the signature. |
| `resource` | exposed to every command as `$RUNBOOK_RESOURCE` (both modes); additionally the **lock key in `shared-dir` mode** (default `repo:<root>`), so runs sharing a resource serialize. |
| `repo` | optional absolute repo root to operate on; defaults to the git root of the cwd. Use to pin a runbook to a fixed repo regardless of where it's invoked. |
| `setups` | array of setup names → `_lib/setups/<n>.sh`, run in order before the command. |
| `cleanups` | array of cleanup names → `_lib/cleanups/<n>.sh`, run after (even on failure). |
| `command` | the body file (default `command.sh`). |
| `report` | `{summary, findings, findingsMax}` parser. See `reporting.md`. |
| `triggers` | optional regexes the hint hook matches against a hand-run command. |
| `pollMs`/`ttlMs`/`timeoutMs` | optional lock tunables; sane defaults otherwise. A slow-but-live run is protected by PID-liveness, not a stale ceiling — raise `timeoutMs` for very long runs. |

## manifest.json — flow

```json
{ "name": "ci", "kind": "flow", "steps": ["lint", "typecheck", "test"] }
```

A flow runs each step through the same engine in order and aggregates: `status` is `fail`/`error`
if any step is, and `steps[]` carries each child's summary + log path. Each step does its own
isolation/locking, so a flow needs none of its own.

## command.sh contract

Runs with `cwd = $RUNBOOK_WORKDIR`. Environment:

- `RUNBOOK_WORKDIR` — where to run (a fresh worktree, or the main checkout for `shared-dir`).
- `RUNBOOK_REPO` — the source repo root.
- `RUNBOOK_REF`, `RUNBOOK_REF_SHA` — resolved target ref.
- `RUNBOOK_RESOURCE`, `RUNBOOK_ISOLATION`, `RUNBOOK_LOG`.

Print to stdout/stderr (captured to the log + parsed). Exit non-zero on failure. The body owns the
real tool call — including `docker exec <container> sh -lc '…'` when the check runs in a container
(use `shared-dir` so the container's mount sees the checkout).

## The shared-setup model (why setups live in `_lib`, edited once)

Setups and cleanups are referenced by name, not copied into each command — so "add a worktree at
diff-vs-master" or "enter the container" is written **once** and reused. Editing a setup changes
every runbook that lists it (and bumps their signatures, busting stale caches automatically). This
is the cure for the copy-paste-and-manually-resync trap of self-contained per-command scripts.
Put helpers shared across setups/cleanups/commands under `_lib/` too.
