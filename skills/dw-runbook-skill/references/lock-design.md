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

- **Ownership = an exclusive meta-file create.** The lock dir is just a container
  (`ensureDir(lockDir)`); ownership is whoever atomically creates `meta.json` inside it with
  `fs.writeFileSync(metaPath, body, {flag: 'wx'})` — a cross-platform compare-and-swap (`EEXIST` if
  someone already holds it) that needs no deps and no `flock(1)` (which macOS lacks). Because the
  create itself is the atomic claim, there's no mkdir→writeMeta gap to race on: an empty lock dir
  is simply claimable by the next exclusive create.
- **Crash recovery.** A holder whose PID is dead (`process.kill(pid, 0)` throws anything other than
  `EPERM`) is reclaimed immediately — liveness is authoritative, so a slow-but-alive leader is
  *never* evicted (evicting a live leader would be a correctness violation for a mutex). There is
  no time-based staleness ceiling. The cost is the inverse case: a crashed holder whose PID gets
  reused by an unrelated process reads as alive and blocks waiters until `timeoutMs` — a loud
  error, never silent corruption. Set `timeoutMs` per command above the worst-case run time so a
  slow-but-live run is never mistaken for a timeout (default 15m).
- **No takeover clobber.** A leader only deletes a meta file whose `token` still matches its own —
  so if a dead-holder reclaim already handed ownership to someone else, the original leader won't
  remove the new owner's claim.
- **No FIFO.** Fairness needs a ticket scheme that lockfiles don't give cheaply; at single-machine
  low parallelism the ~`pollMs` wait is fine. The whole lock sits behind a narrow interface, so it
  can be swapped for a background-daemon implementation later **without changing any runbook**.

## Proof

`node scripts/lock.js --self-test` spawns real worker processes and asserts: (A) distinct
signatures on one resource never overlap in the critical section and all execute; (B) identical
signatures collapse to exactly one execution, the rest coalesce; (C) a dead holder's lock is
reclaimed. `node scripts/run.js --self-test` proves both modes end-to-end against a temp git repo,
including the pristine guarantee and the coalesce cache. Both run in CI.
