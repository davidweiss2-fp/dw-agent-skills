# Convergence cleanup on your own PR

Two of your agents argue on your own PR so the reasoning is visible while it matters. Once it stops
mattering, that exchange is scaffolding: a human reviewer arriving later reads a long machine
conversation before reaching the change. This protocol is how both sides agree the scaffolding can
come down.

It applies to **your own PRs only**, and to **your own comments only**.

## Who can start it

The trigger lives **on the PR**, as free text, so a run can find it without any chat context.
Wording is whatever the moment produced - "cleanup the PR from agents comments", "clear the bot
chatter", "we're done here, tidy this". Recognising that intent is judgment. *Who said it* is not,
and is checked in code.

| Trigger | Enough on its own? |
|---|---|
| The PR owner's own comment, carrying **no tag** | **Yes.** One comment, any wording, no second voice needed. |
| One agent side asking | No - that is a proposal. |
| Both sides, one comment each (`[dev-review-ai]` + `[dev-author-ai]`) | Yes - the sides agreeing the exchange is over. |
| Anyone else, or a bot | Never. |

Both agents post under the owner's account, so **author identity cannot tell the owner from their
own agent** - the tag can. The human is the one who signs nothing, so an untagged comment by the
owner is the owner speaking, and a tagged one is not. Without that rule the agents could authorize
themselves by asking nicely.

A comment by anyone else is a suggestion in a thread, not an instruction to delete the owner's
words. It never authorizes, however plainly it is phrased.

Name the comment when you run it, which also leaves the audit trail:

```bash
node scripts/review-prs.js cleanup <pr> --delete --authorized-by <comment-id[,id]>
```

The run prints what it read as its instruction before removing anything. The trigger comment itself
survives: it is a standalone comment nobody replied under, so the guards keep it, and it stays as
the record of what was agreed.

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
| **Superseded inner draft** | a pending draft, not the newest on its thread, in a thread with only your own agents in it | nobody - it is unpublished | GraphQL, by **node id** (`PRRC_…`) |
| **Published comment** | your comment in a thread that got a reply | anyone reading the PR | REST, by **database id** (a number) |
| **Outer draft** | any pending draft in a thread a person has written in | nobody yet - but someone is waiting for it | **never removed** |
| **Agent-only thread** | a published thread only the two agents used, where **both** have spoken | anyone reading the PR | the two sides agreeing is enough |
| **Thread a person wrote in** | your published comment where a person replied | anyone reading the PR | **the owner only** |

**Handled comments can clear themselves, within one boundary.** When both sides have spoken in a
thread and agree it is done, that thread is theirs to tidy and no owner instruction is needed. A
thread a person wrote in is a conversation with them: agreement between your two agents says
nothing about it, and clearing your side of it stays your call.

Both sides having *spoken* is the test, not one side declaring it finished. A lone signed comment
with no answer reads as human-free only because nobody has replied yet - it is often the agent
addressing a person - so it is kept, for the same reason an outer draft is.

**Inner and outer is the distinction that matters most here.** An inner draft is your agents
talking to each other; an outer one answers a human. Outer drafts stay however stale they look,
because the cost is asymmetric: a superseded inner draft is clutter between two of your own agents,
while a dropped outer draft is a reply a person is still waiting for, and nothing afterwards shows
it went missing.

A draft can reply to a human's *reply* rather than to the comment that opened the thread, so
membership is judged across the whole thread, not just its root. Bots do not make a thread outer -
we never reply to them.

Two of your drafts on one thread means the older was rewritten rather than answered, which is how
"Agreed, this comes out of the PR" ends up shipping next to "Done in `<sha>`". The newest is kept:
it is the one that says what you currently mean.

**The two id types are not interchangeable**, and the listing prints the right one for each action.
`surfaces` reports database ids for published comments and node ids for drafts; feeding a database
id to `drop` fails, and the only way to find out is to make the call.

## What may be removed, and what never may

```bash
node scripts/review-prs.js cleanup <pr>                  # list only, the default
node scripts/review-prs.js cleanup <pr> --delete --authorized-by <id>   # remove them
```

Three guards live in the code rather than in this prose, because a cleanup that reads the protocol
generously is exactly the failure worth preventing:

| Guard | Why |
|---|---|
| The PR must be authored by you | The protocol is an agreement between your agents about your words. On someone else's PR you are a guest. |
| Every candidate must be authored by you | Another person's comment is never removable, at any tag, under any agreement. |
| Nobody-replied-under-it is kept | A root with no reply from anyone else is the shape of an ask that never landed. Removing it deletes the question along with the record that it went unanswered. |

`cleanup` lists by default and deletes nothing. Deleting published comments is irreversible and
outward-facing, so it takes `--delete` **and** the id of the comment that asked for it. An agent
does not decide the discussion has converged and act on it in the same breath.

| Excuse | Reality |
|---|---|
| "I think it has converged, so I can run the delete" | Converged is the precondition; a trigger comment is the authorization, and they are different things. Without one, propose the list and stop. |
| "The owner clearly meant cleanup earlier in the thread" | Then there is a comment to name. If you cannot point at one, you are inferring permission rather than reading it. |
| "This one is obviously noise — a one-line ack nobody needs" | Then it costs nothing to leave it. The comments worth removing are the ones the tool already lists; reaching past that list is how someone else's thread loses a reply. |
| "The thread is resolved on GitHub, so it converged" | Resolution is a UI state anyone can click, including to tidy their own view. Convergence is the two conditions above, checked against what the threads actually say. |

## After it runs

Say what was removed and what was kept, and why the kept ones were kept — the unanswered set is
usually the interesting output. A reviewer who arrives later should still be able to see that the
change was reviewed; if the cleanup would leave no trace of that at all, submit a short summary
comment first and remove the rest.
