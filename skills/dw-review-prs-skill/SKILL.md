---
name: dw-review-prs-skill
description: >-
  Review the pull requests waiting on you and leave every finding as an
  UNSUBMITTED [dev-review-ai] review, so nothing reaches the author until you submit it
  yourself. Starts by reading what you already drafted, what you already posted,
  and what every other reviewer and bot has said, then reports the PRs still
  missing your draft with links. Use when the user asks "review the PRs I was
  asked to review", "what PRs are waiting on me", "draft my review comments",
  "review my review queue", or invokes /dw-review-prs.
---

# Draft the reviews waiting on you

One job: for every PR where review is requested of the user, leave a **pending (unsubmitted)**
review whose comments are ready to send. The user reads the drafts in the GitHub UI and submits.
You never submit unless told to, naming the event.

Requires `gh` authenticated (`gh auth status`). Run the script from this skill directory.

## Mechanics

| Command | Does |
|---|---|
| `node scripts/review-prs.js queue` | PRs requested of you or your teams, reviewed by you, or mentioning you — classified against the store (`--json`, `--days N`, `--all-time`, `--participation`) |
| `… surfaces <pr>` | Your pending drafts, your submitted reviews, and every published comment (human and bot) |
| `… threads <pr>` | Review threads with node ids, for replying into an existing thread |
| `… draft <pr> --path P --line N --body-file F` | New draft comment on a diff line; opens the pending review if needed |
| `… reply <pr> --thread ID --body-file F` | Draft reply inside someone else's thread |
| `… edit --comment NODE_ID --body-file F` / `drop --comment NODE_ID` | Rewrite or delete one of your drafts |
| `… submit <pr> --event COMMENT\|APPROVE\|REQUEST_CHANGES` | Publish the pending review — only on explicit instruction |
| `… state-set <pr> --status drafted\|submitted\|declined` | Record the head SHA handled |
| `… log <pr> --status S --weight W --finding TEXT` | Append to the comment ledger |
| `… cleanup <pr>` | List what a converged discussion can remove from your OWN PR — superseded inner drafts and your published comments; removing needs `--delete --authorized-by <comment-id>` |
| `… watch` | Long-running: new comments on every PR in scope, and newly actionable PRs from the queue (Step 7) |
| `… dashboard --out FILE [--actions FILE]` | Build the reviewer's status page (Step 5) |
| `… dashboard-url [--set URL]` | The artifact URL that page is published to |

Store (read at the start, write at the end): `<DW_STORE_ROOT or ~/Documents/dw-agent-store>/run-notes/dw-review-prs/`
— `state.md` (head SHA per PR: same SHA means handled, different SHA means review the delta) and
`comments.md` (every finding ever drafted or submitted).

`authors.json` in that same directory carries **per-author review instructions**, keyed by login —
who they are, `dw-knowledge` names to recall, extra `steps`, and `instructions` constraining the
comment text. Some authors need the review delivered differently, and that is data rather than
skill, so one JSON edit reaches every routine that runs this skill.

Notes **never change how a PR is classified** — an author needing a different register is still
ordinary review work. They change how the review is written and delivered, so `surfaces` returns the
matching entry (Step 2 already makes `surfaces` mandatory, which is why they ride there rather than
in a command that can be forgotten) and `queue` tags the row `[author notes]`. Shape, field
contract and a worked example: `references/authors.md`.

## Step 1 — Read the queue

`queue` unions review requests aimed at you or your teams with `reviewed-by:@me` and `mentions:@me`,
then re-resolves every hit through the PR endpoint. A request is never aged out; the broad sources are
pruned by `--days` (14 by default), and anything the store records as `drafted` is retained whatever
its age. Which source is windowed and why: `references/queue.md`.

Statuses:

| Status | Meaning | Move |
|---|---|---|
| `draft-waiting` | Unsubmitted drafts already sit on the PR | Report the link; the user submits or asks for edits |
| `needs-draft` | No review from you, or pushed to since your last one | Full review, Steps 2-4 |
| `draft-empty` | An empty pending review holds the one-per-PR slot | Draft into it, or `drop` its remnants |
| `answered` | The author replied after your review — it is back with you | Read the reply, Steps 2-4 |
| `reviewed` | You reviewed it and it is approved | One line, no work |
| `undecided` | You reviewed it and nobody has approved it | One line; chase or approve |
| `changes-requested` | Changes requested and not yet resolved | One line, waiting on the author |
| `not-ready` | The author has it back in draft | One line; reviewing a WIP is wasted |
| `watching` | You took part in a thread, but review was never requested of you | One line, no work |
| `skip` / `closed` | Declined at this head, or gone | One line, no work |

Your **own** PRs are classified on exactly these terms — same statuses, same lifecycle, same work.
Authorship is a property of the row (`[yours]` in the listing), not a status, and it changes only
two things: where the review's context may come from (Step 3), and that GitHub allows only
`--event COMMENT` when you submit.

**Done when** every open request is classified and the actionable ones are reported to the user as
links, newest work first.

## Step 2 — Read what already exists, before forming an opinion

Per PR in scope: `surfaces` (all three comment surfaces, your own drafts, and any `authorNotes`
for the author), `threads`, the store's `comments.md`, the diff, and the surrounding code on the
base branch. Read the linked ticket's acceptance criteria before raising anything scope-shaped.

When `surfaces` returns `authorNotes`, apply them before drafting a word: recall each name under
`knowledge`, carry out each `steps` entry at the point it names, and write every comment to
`instructions`. They are the reviewer's standing decision about that person, not a suggestion.

**Done when** you can name, for that PR: your own drafts, your published comments, every finding
another reviewer or bot already raised — none of which your findings duplicate — and, where the
author has notes, what those notes change about this review.

## Step 3 — Review the change

Correctness first, then design, naming, tests, and whether the change leaves a seam half-finished.
That is the order attention pays off in, not a boundary on what counts as a finding. Recall the
repo's review conventions through `dw-knowledge` rather than assuming them.

Substantiate every finding against the real code: trace the helper, read the callee's signature,
check what the test asserts. Verify empirically where you can — run the one test, execute the
snippet, query the local database — and say plainly when you could not. Drop what you cannot
substantiate. Depth follows review state: on a PR already carrying CHANGES_REQUESTED on its
approach, note only what survives the rewrite.

**Does the diff deliver the ticket, and only the ticket?** Two failures, and they need different
comments. *Under-delivering* is an AC the diff silently does not cover — the finding is "make the
split explicit in the PR body or trim the ticket", not "you forgot". *Over-delivering* is anything
in the diff the ticket does not ask for and the change does not need — a new endpoint where the
existing one owns the behavior, a sibling path rewired in passing, are two ways it shows up, not
the two ways. The question that finds the rest: strike this hunk, and does the ticket still get
delivered? Both failures cost the reviewer, and the second costs the blast radius too. Name the
specific AC or the specific unnecessary hunk — a general "this feels big" is not a finding.

**Guard code quality on what the diff adds.** The test is a question, not a checklist: for each
thing the diff introduces, ask what it costs the next person who touches this file — are they
misled about what it does, slowed down finding it, or forced to change more than their task should
require? Whatever answers yes is a finding, named smell or not.

Named smells are where to start looking, not where to stop — imprecise naming, a unit doing two
jobs, a dead seam, visibility that exists only for a test, a repeated shape wanting extraction, a
test that restates the implementation. Most defects worth raising are not on that list, because
the list is the ones that already have names. Recall the repo's own conventions through
`dw-knowledge` too, rather than importing generic taste.

Hold a quality finding to the same evidence bar as a correctness one. "I would have written it
differently" is not a defect; "this name says X and the function does Y" is.

### Reviewing your own PR

Your own PRs are ordinary review work, with one rule that changes: **take context only from sources
a stranger could reach** — the diff at the PR's ref, what is committed locally, the PR description,
the ticket and its ACs, the comment surfaces. Nothing from the session that wrote the code.

Knowing the intent is what lets a reviewer talk themselves out of a real defect: the code matches
what you meant, so the gap between what you meant and what you wrote goes invisible — and that gap
is what review is for. Once your review is submitted the PR's card offers a copy-ready brief for
whichever agent does the work. Both, plus the tag conventions that let two agents argue on the
thread: `references/own-prs.md`.

**When that argument is over**, the exchange is scaffolding standing in front of the change, and
`cleanup <pr>` lists your own comments that can come down. It deletes nothing by default. What
counts as converged, the three guards, and why a comment nobody replied under is always kept:
`references/cleanup.md`. The trigger is a free-text comment **on the PR**: your own untagged one is
enough by itself, or one from each agent side. Nobody else's counts, and a draft answering a person
is never removed.

## Step 4 — Draft one comment per finding

`draft` for a new thread, `reply` to join an existing one. The script refuses a body that does not
carry the `[dev-review-ai]` tag and open on an `Ask:` line.

Every comment leads with its ask, in this shape:

```
[dev-review-ai]
Ask: <the one closeable action, imperative>

<weight>: <the finding, one sentence>

<evidence, then reasoning>
```

- **The `Ask:`** is imperative, one action, and closeable by the author — "restore the when-clause
  on `@throws`", "align RD-1234's AC with what the PR delivers". One ask per comment; two findings
  means two comments. Alternatives joined by "or" belong here only when choosing between them is
  itself the ask.
- **The weight label** — blocker / please fix / suggestion / nit — sits on the line that states the
  finding, and does the framing on its own.
- **Evidence** is one line or one short block: the minimum that lets the author check it themselves.
- **150 words per comment, 250 with a code block.** Over budget means cut, not rephrase.
- **A one-line code change ships as a ` ```suggestion ` block** in the evidence slot, matching the
  anchored line verbatim, indentation included, so the author closes it in one click. `draft` anchors
  a single line, so a fix spanning more than one line is prose, not a suggestion block.
- **Quote code verbatim** and never elide a list the argument depends on. **Name the unit** — a row,
  a sale, a shopper. **Try to falsify the finding** before drafting: can the state it describes
  actually occur?
- Cut the closing "general rule" paragraph, the inventory of things that turned out fine, and
  anything hedged with "arguably".

For anything at the top of the budget, hand the rendered draft to a subagent with no session context
and ask it to restate the claim; if it cannot, the draft is not ready.

**Done when** every surviving finding is drafted on the PR, every body's first line after `[dev-review-ai]`
is its `Ask:` line, and nothing is submitted.

## Step 5 — Hand over: refresh the status page, then report

The reviewer's own surface is one published page, re-published to the same URL every run — every PR
the store records, its state, and the single next step waiting on them.

```bash
node scripts/review-prs.js dashboard --out queue.html --actions actions.json
```

You write `actions.json`: per PR the free-text `next`, a short `cta`, and a `lane` when the derived
one is wrong. Field contract, how a card with unsubmitted drafts differs, and the publishing rules
that keep the URL stable: `references/dashboard.md`.

Then report in chat as well: per PR the `/files` link, what was drafted with one line each, what was
dropped and why, and anything that does not belong on a PR at all. Say explicitly that the review is
unsubmitted and how to submit it.

The page hands feedback back as a pasted block, and each comment in it re-enters at Step 2. A
`Do these` line is the reviewer's instruction, and it is **the one route by which `submit` is
authorized without them naming the event in chat** — `submit them as APPROVE` names it, so run
`submit --event APPROVE` on that PR and nothing else.

**Done when** the page is republished to its recorded URL, every card carries a next step and a
button, and the chat report says the review is unsubmitted.

## Step 6 — Close out

`state-set` per PR touched, `log` per drafted comment. Capture anything durable — a repo convention,
a correction to these steps — through `dw-knowledge`.

**Done when** `state.md` carries the head SHA for every PR reviewed this run and `comments.md` has a
row per draft.

## Step 7 — Keep listening

A drafted review is half a conversation, and the queue does not stop moving when the run ends.

```bash
node scripts/review-prs.js watch
```

It takes no options and **loops until the process is stopped** - there is no single-pass mode. It
polls every PR in scope for new comments every two minutes, and re-runs the queue every fifteen so
a PR whose review was requested after the run still reaches you.

Which of the two you reach for is decided by the session, not by a flag:

- **One look** - a run that starts, works and exits calls `queue`. It classifies every open
  request, newly actionable ones included, and is blind to new comments on PRs already drafted on.
- **Resident** - a session that stays up arms `watch` as a persistent monitor, so both signals
  arrive as events for as long as the session lives. Its first sweep runs immediately and reports
  every actionable PR, so a restarted session opens on the whole backlog rather than on the delta
  since the last one.

How to arm it, what it polls, what stays quiet, and why the two clocks differ: `references/watch.md`.

Everything it reports re-enters at Step 2 — a comment means read the thread and draft the reply
through `reply`; a `[queue]` line means a full review, Steps 2-4.

**Done when** every reported comment is either answered with a draft or named as needing nothing,
every PR the sweep surfaced is drafted on or classified, and a resident session still holds an armed
monitor.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The review is drafted; submitting is the obvious next step" | Submitting is the user's call, and it is the only irreversible step here. A draft costs nothing to rewrite. Submit only when told to, with an explicit `--event`. |
| "I'll post this one comment straight to the PR, it's faster" | A published comment cannot be redrafted, and an open pending review makes REST posting fail anyway (422, one pending review per user per PR). Everything goes through `draft`. |
| "I read the diff and know what's wrong — surfaces can wait" | Bots and other reviewers have usually said it already. A duplicate finding wastes the author's time and costs the review its credibility. Read the surfaces first, every run. |
| "The PR is unchanged since the last run, but another look can't hurt" | A matching head SHA in `state.md` means handled. Re-reviewing it re-delivers findings the author already has. |
| "No findings — I should write something so the run isn't empty" | An empty queue or a clean PR is a real result. Say so in one line. |
| "I'll write the status page HTML myself, it's just one page" | The page's markup, themes and behaviour live in `scripts/review-prs-dashboard.js` so every reviewer on this skill gets the same interface and the same fixes. Hand-written HTML is a private one-off that drifts on the next run. Pass data through `--actions`; change the renderer if the page itself is wrong. |
| "I went through the quality list and none of it applies, so there is nothing to flag" | The list names the defects that already have names; it cannot be the complete set, because the next one has not been named yet. What binds is the question asked of each thing the diff adds — what does this cost the next person to touch it? A clean pass over the examples with the question never asked is not a clean review, it is an unread one. |
| "I'll read `scripts/review-prs.js` to see what this command actually does" | Every fact you need about a command is in this file or behind one of its pointers, and reading the implementation instead costs a few thousand tokens to re-derive it. Worse, the installed copy you would grep can be a different version from the one you are running. If the answer genuinely is not written down, that is a defect in this skill: say so, and it gets written down once for every future run. |
| "It's a nit — the ask is obvious from the label, an `Ask:` line is overhead" | Obvious to you, inferred by the author. "Worth restoring the clause" reads as an observation to file away; `Ask: restore the when-clause` reads as a thread to close. The smaller the finding, the cheaper its ask is to state. |

## Hard rules

- Nothing is submitted without an explicit instruction naming the event.
- Every drafted body carries `[dev-review-ai]`, so a later run can tell its own comments from a
  human's. Its counterpart is `[dev-author-ai]`, worn by any agent acting FOR the author - the
  PR-babysitting skill, or the agent working the comments. The pair replaced a single `[dev-ai]`,
  which named an AI rather than a side, and was duly worn by both. Both old tags are still
  recognised on read; neither is written any more.
- Findings are substantiated against the code, or dropped.
