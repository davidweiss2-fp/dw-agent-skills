# The watch loop

```bash
node scripts/review-prs.js watch
```

Two jobs on two clocks: it polls known PRs for **new comments**, and it re-runs the **queue** to
catch PRs that became work after the run ended.

It takes no options. Comments poll every 2 minutes, the queue sweeps every 15, bots never report,
and every PR state is polled. Those were flags once; none earned its surface, and a generic
`--key value` parser turned a typo'd flag into a silent default rather than an error.

## What it polls

**Every PR `state.md` has ever recorded**, across repos, including merged and closed ones — a
thread outlives its merge, and someone answering your comment two days after the PR merged is still
waiting on you. Plus every open PR the last queue sweep saw, which is how a PR that never reaches
`state.md` — notably your own, since nothing is drafted on it first — gets its replies polled.

`state.md` is re-read every pass, so a PR another run drafts on joins the watch without a restart.

## What reports, and what stays quiet

- **Bots and your own comments never report.** What surfaces is a person waiting on a reply.
- **A high-water mark per PR per surface** lives in `watch-state.json`. The first pass on a PR seeds
  those marks and reports nothing, rather than replaying its whole history. The mark advances past
  filtered comments too, so a bot comment is seen-but-unshown and no later pass re-examines it.
- **The queue sweep is throttled separately** because it re-resolves every review request through
  the PR endpoint and costs far more than a comment poll. Only actionable rows report, keyed on
  `status@headSha`: a PR resurfaces when it is pushed to or moves `needs-draft` → `answered`, and a
  quiet one stays quiet. A PR that leaves the actionable set is forgotten, so returning to it
  reports again.
- **Unlike the comment marks, the first sweep does report.** An actionable PR is work waiting
  whether or not this process has seen it before — seeding it silently would hide exactly what the
  sweep is for.
- **One unreachable PR is a line of output, not the end of the pass.** A deleted PR or a revoked
  token on one repo leaves the others reporting.

## What to do with what it reports

Everything re-enters the skill at Step 2. A comment means read the thread and draft the reply
through `reply`; a `[queue]` line means a full review, Steps 2-4.

An answer that closes a thread is worth saying so in one line. An answer that resolves nothing needs
the verification pass first — a colleague's "I checked and it's fine" is evidence to confirm, not a
finding to drop on trust.
