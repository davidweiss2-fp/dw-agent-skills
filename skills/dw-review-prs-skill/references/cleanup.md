# Convergence cleanup on your own PR

Two of your agents argue on your own PR so the reasoning is visible while it matters. Once it stops
mattering, that exchange is scaffolding: a human reviewer arriving later reads a long machine
conversation before reaching the change. This protocol is how both sides agree the scaffolding can
come down.

It applies to **your own PRs only**, and to **your own comments only**.

## When the discussion has converged

Both sides have to be able to say yes, independently:

- **The reviewing side** (`[dev-review-ai]`): every finding it raised is either fixed in the branch,
  withdrawn in the thread, or carried somewhere durable — a ticket, the PR body. Nothing it asked
  for is waiting on an answer.
- **The author side** (`[dev-author-ai]`): every reply it owes is written, and nothing it pushed
  back on is still open. If it refuted a finding, the refutation was accepted rather than ignored.
- **Both**: the branch is in the form it will merge in, and neither side has an action left.

"Nobody has posted for a while" is not convergence. Silence is what an unanswered ask and a settled
thread have in common, which is why the tool refuses to remove anything nobody replied under.

## Two kinds of removable, two different APIs

`cleanup` covers both in one listing, because they are invisible to each other otherwise - a
cleanup that looked only at published comments once reported "0 removable" with four superseded
drafts sitting on the PR.

| | What it is | Who has seen it | Removed by |
|---|---|---|---|
| **Superseded draft** | every pending draft on a thread but the newest | nobody - it is unpublished | GraphQL, by **node id** (`PRRC_…`) |
| **Published comment** | your comment in a thread that got a reply | anyone reading the PR | REST, by **database id** (a number) |

Two of your drafts on one thread means the older was rewritten rather than answered, which is how
"Agreed, this comes out of the PR" ends up shipping next to "Done in `<sha>`". The newest is kept:
it is the one that says what you currently mean.

**The two id types are not interchangeable**, and the listing prints the right one for each action.
`surfaces` reports database ids for published comments and node ids for drafts; feeding a database
id to `drop` fails, and the only way to find out is to make the call.

## What may be removed, and what never may

```bash
node scripts/review-prs.js cleanup <pr>                  # list only, the default
node scripts/review-prs.js cleanup <pr> --delete --yes   # remove the listed comments
```

Three guards live in the code rather than in this prose, because a cleanup that reads the protocol
generously is exactly the failure worth preventing:

| Guard | Why |
|---|---|
| The PR must be authored by you | The protocol is an agreement between your agents about your words. On someone else's PR you are a guest. |
| Every candidate must be authored by you | Another person's comment is never removable, at any tag, under any agreement. |
| Nobody-replied-under-it is kept | A root with no reply from anyone else is the shape of an ask that never landed. Removing it deletes the question along with the record that it went unanswered. |

`cleanup` lists by default and deletes nothing. Deleting published comments is irreversible and
outward-facing, so it takes `--delete --yes` **and** an explicit instruction from the user naming
the PR. An agent does not decide the discussion has converged and act on it in the same breath.

| Excuse | Reality |
|---|---|
| "Both sides agree it is settled, so I can run the delete" | Agreement between two of your agents is the precondition, not the authorization. The user says when, on which PR, out loud. Propose the list and stop. |
| "This one is obviously noise — a one-line ack nobody needs" | Then it costs nothing to leave it. The comments worth removing are the ones the tool already lists; reaching past that list is how someone else's thread loses a reply. |
| "The thread is resolved on GitHub, so it converged" | Resolution is a UI state anyone can click, including to tidy their own view. Convergence is the two conditions above, checked against what the threads actually say. |

## After it runs

Say what was removed and what was kept, and why the kept ones were kept — the unanswered set is
usually the interesting output. A reviewer who arrives later should still be able to see that the
change was reviewed; if the cleanup would leave no trace of that at all, submit a short summary
comment first and remove the rest.
