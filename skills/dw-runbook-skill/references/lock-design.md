# Isolation & the single-flight lock

Two isolation modes, one coordinator. The goal: any runbook is safe to fire **without knowing the
repo's current state**, and parallel agents never corrupt each other's working tree.

## Modes

- **`worktree`** — the runner `git worktree add --detach`s a throwaway checkout at the target ref
  under `<store>/.worktrees/`, runs there, and `git worktree remove --force`s it. Each run owns
  its directory, so different runs are **inherently parallel-safe and take no resource lock**.
  Requires a committed ref (you can't worktree the dirty working tree).
- **`shared-dir`** — for tools bound to the main checkout (a Docker mount such as
  `<your-container>` only sees one host path). The runner runs **in the repo root** and therefore
  must serialize.
  It brackets the run with a **pristine guarantee**: snapshot `HEAD` + `git status --porcelain`
  before; after cleanups, assert both are unchanged. Drift ⇒ `status: "error"` (the cleanups
  failed to restore). The runner never auto-`reset`s — that would be destructive.

## The coordinator (`lock.js`)

One primitive, keyed by mode:

- **mutex key** = the **resource** (`shared-dir`): different signatures are mutually exclusive on
  the shared checkout.
- **coalesce key** = the **signature** `(name, kind, isolation, ref-label, ref-sha, dirty,
  file-versions)`: identical runs share one execution + one result. In `worktree` mode the lock is
  keyed by signature, so different signatures run fully in parallel and only identical ones
  coalesce.

`coordinate()` returns a lease whose `role` is:

- `leader` — you run, then `writeResultAtomic()` + `release()`.
- `coalesced` — an identical run was in flight; its result is at `resultPath`.
- `cached` — a fresh result already existed (within `ttlMs`); never ran.

So N agents asking for the same check pay for **one** run; everyone else reads the result.

## Why these mechanics

- **Atomicity = `mkdir`.** `mkdir` fails with `EEXIST` if the dir exists — an atomic test-and-set
  that works on macOS and Linux with no deps. (macOS ships no `flock(1)`; a check-then-write
  lockfile has a TOCTOU race that produces two leaders.) A `meta.json` written *just after* the
  `mkdir` records `{pid, token, startedAt, sig, state}`; a lock dir with no meta yet but younger
  than `graceMs` is a leader still initializing, not a stale lock — this closes the
  mkdir→writeMeta gap that would otherwise let a waiter steal the lock.
- **Crash recovery.** A holder whose PID is dead (`process.kill(pid, 0)` → `ESRCH`) is reclaimed;
  a `staleMs` ceiling reclaims a lock whose PID was reused by an unrelated process. Set `staleMs`
  per command above the worst-case run time so a slow-but-live run is never stolen (default 15m).
- **No takeover clobber.** A leader only deletes a lock dir whose `token` still matches its own —
  so if a stale-takeover already handed the dir to someone else, the original slow leader won't
  remove the new owner's lock.
- **No FIFO.** Fairness needs a ticket scheme that lockfiles don't give cheaply; at single-machine
  low parallelism the ~`pollMs` wait is fine. The whole lock sits behind a narrow interface, so it
  can be swapped for a background-daemon implementation later **without changing any runbook**.

## Proof

`node scripts/lock.js --self-test` spawns real worker processes and asserts: (A) distinct
signatures on one resource never overlap in the critical section and all execute; (B) identical
signatures collapse to exactly one execution, the rest coalesce; (C) a dead holder's lock is
reclaimed. `node scripts/run.js --self-test` proves both modes end-to-end against a temp git repo,
including the pristine guarantee and the coalesce cache. Both run in CI.
