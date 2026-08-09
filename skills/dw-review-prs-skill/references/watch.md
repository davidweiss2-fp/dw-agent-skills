# The watch loop

```bash
node scripts/review-prs.js watch
```

Two jobs on two clocks: it polls known PRs for **new comments**, and it re-runs the **queue** to
catch PRs that became work after the run ended.

It takes no options. Comments poll every 2 minutes, the queue sweeps every 15, bots never report,
and every PR state is polled. Those were flags once; none earned its surface, and a generic
`--key value` parser turned a typo'd flag into a silent default rather than an error.

## Arming it in a resident session

A session that stays up runs the loop as a **persistent monitor**, not a background shell, so each
line becomes an event in that session rather than text in a file nobody reads:

```
Monitor({ command: "cd <this skill dir> && node scripts/review-prs.js watch 2>&1",
          description: "new PR comments and newly actionable PRs",
          persistent: true })
```

`2>&1` is deliberate: a revoked token or an unreachable repo has to arrive as an event, because
silence from this loop is indistinguishable from a quiet queue. The loop only exits on failure, so
an exit means the session has stopped listening while still looking alive - say so and re-arm.

**Steady state** for such a session: the monitor is armed, every event so far is answered with a
draft or named as needing nothing, and the published page matches the store.

## What it polls

**Every PR `state.md` has ever recorded**, across repos, including merged and closed ones — a
thread outlives its merge, and someone answering your comment two days after the PR merged is still
waiting on you. Plus every open PR the last queue sweep saw, which is how a PR that never reaches
`state.md` — notably your own, since nothing is drafted on it first — gets its replies polled.

`state.md` is re-read every pass, so a PR another run drafts on joins the watch without a restart.

## What reports, and what stays quiet

- **What reports is judged by signature, not by author.** Both agents post under your account, so
  filtering on login silenced *your own* comments on your own PR - the one channel you have to talk
  to the agent there. The reviewing watch skips only comments opening with `[dev-review-ai]`, its
  own echo. Everything else reports: anything unsigned whoever wrote it, you included, and the
  other side's `[dev-author-ai]`, so a message from the author's agent reaches this watch and back.
  A tag counts as a signature only when it *opens* the comment - someone quoting one mid-sentence
  is asking about it, which is the comment most worth surfacing.
- **Unsubmitted drafts are polled too.** They appear on no published endpoint, so a reply you leave
  as a draft on your own PR would otherwise reach nobody. Bots still never report.
- **A high-water mark per PR per surface** lives in `watch-state.json`. The first pass on a PR seeds
  those marks and reports nothing, rather than replaying its whole history. The mark advances past
  filtered comments too, so a bot comment is seen-but-unshown and no later pass re-examines it.
- **The queue sweep is throttled separately** because it re-resolves every review request through
  the PR endpoint and costs far more than a comment poll. Only actionable rows report, keyed on
  `status@headSha`: a PR resurfaces when it is pushed to or moves `needs-draft` → `answered`, and a
  quiet one stays quiet. A PR that leaves the actionable set is forgotten, so returning to it
  reports again.
- **The first sweep of a process runs at once and reports everything actionable.** It fires before
  the first comment pass, and it ignores the stored marks rather than deduping against them, because
  `queueSeen` outlives the process: a restart that deduped would open blind to exactly the work the
  last run reported and nobody has acted on yet. Later sweeps in that process dedupe as normal, which
  is what keeps a quiet queue quiet. The `[queue] N …` summary line says `actionable` on that first
  sweep and `new` afterwards.
- **One unreachable PR is a line of output, not the end of the pass.** A deleted PR or a revoked
  token on one repo leaves the others reporting.

## What to do with what it reports

Everything re-enters the skill at Step 2. A comment means read the thread and draft the reply
through `reply`; a `[queue]` line means a full review, Steps 2-4.

An answer that closes a thread is worth saying so in one line. An answer that resolves nothing needs
the verification pass first — a colleague's "I checked and it's fine" is evidence to confirm, not a
finding to drop on trust.
