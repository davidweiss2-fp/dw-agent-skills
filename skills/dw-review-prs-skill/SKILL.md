---
name: dw-review-prs-skill
description: >-
  Review the pull requests waiting on you and leave every finding as an
  UNSUBMITTED [dev-ai] review, so nothing reaches the author until you submit it
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
| `… watch` | Long-running: new comments on every PR in scope, and newly actionable PRs from the queue (Step 7) |
| `… dashboard --out FILE [--actions FILE]` | Build the reviewer's status page (Step 5) |
| `… dashboard-url [--set URL]` | The artifact URL that page is published to |

Store (read at the start, write at the end): `<DW_STORE_ROOT or ~/Documents/dw-agent-store>/run-notes/dw-review-prs/`
— `state.md` (head SHA per PR: same SHA means handled, different SHA means review the delta) and
`comments.md` (every finding ever drafted or submitted).

`delegated-authors.json` in that same directory hands whole authors to another routine —
`{"login": "why"}`. Their PRs classify `delegated` and never become work here, so the hand-off
survives a run where nobody remembers to decline them one at a time. It is checked *after* the
pending-review checks on purpose: an unsubmitted review of ours on a delegated PR still surfaces,
because a pending review blocks REST comment posting on that PR (one per user per PR) and would
silently break the routine the PR was handed to.

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
| `mine` | Your own PR - not review work, but your reviewers' threads land on it | Watched for comments; reply with `reply` |
| `skip` / `closed` | Declined at this head, or gone | One line, no work |

**Done when** every open request is classified and the actionable ones are reported to the user as
links, newest work first.

## Step 2 — Read what already exists, before forming an opinion

Per PR in scope: `surfaces` (all three comment surfaces plus your own drafts), `threads`, the store's
`comments.md`, the diff, and the surrounding code on the base branch. Read the linked ticket's
acceptance criteria before raising anything scope-shaped.

**Done when** you can name, for that PR: your own drafts, your published comments, and every finding
another reviewer or bot already raised — and no finding you carry forward duplicates one of them.

## Step 3 — Review the change

Correctness first, then design, naming, tests, and whether the change leaves a seam half-finished.
Recall the repo's review conventions through `dw-knowledge` rather than assuming them.

Substantiate every finding against the real code: trace the helper, read the callee's signature,
check what the test asserts. Verify empirically where you can — run the one test, execute the
snippet, query the local database — and say plainly when you could not. Drop what you cannot
substantiate. Depth follows review state: on a PR already carrying CHANGES_REQUESTED on its
approach, note only what survives the rewrite.

**Does the diff deliver the ticket, and only the ticket?** Two failures, and they need different
comments. *Under-delivering* is an AC the diff silently does not cover — the finding is "make the
split explicit in the PR body or trim the ticket", not "you forgot". *Over-delivering* is a diff
that reaches past what the ticket asked for: a new endpoint where the existing one owns the
behavior, a sibling path rewired in passing, a file touched that nothing required. Both cost the
reviewer, and the second costs the blast radius too. Name the specific AC or the specific
unnecessary file — a general "this feels big" is not a finding.

**Guard code quality on what the diff adds.** Naming that says what the thing is, one concept per
class or function, no dead seam left behind, no public surface that exists only so a test can reach
it, no repeated shape that wants extracting, tests that assert behavior rather than restating the
implementation. Recall the repo's own conventions rather than importing generic taste — and hold a
quality finding to the same evidence bar as a correctness one, since "I would have written it
differently" is not a defect.

**Done when** each finding is either substantiated with the evidence you'd quote, or dropped, and
the diff has been checked against the ticket's ACs in both directions.

## Step 4 — Draft one comment per finding

`draft` for a new thread, `reply` to join an existing one. The script refuses a body that does not
carry the `[dev-ai]` tag and open on an `Ask:` line.

Every comment leads with its ask, in this shape:

```
[dev-ai]
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

**Done when** every surviving finding is drafted on the PR, every body's first line after `[dev-ai]`
is its `Ask:` line, and nothing is submitted.

## Step 5 — Hand over: refresh the status page, then report

The reviewer's own surface is one published page, re-published to the same URL every run — every PR
the store records, its state, and the single next step waiting on them. Full field reference and the
publishing rules: `references/dashboard.md`.

```bash
node scripts/review-prs.js dashboard --out queue.html --actions actions.json
```

Write `actions.json` yourself — per PR a `next` (the free-text next step), a short `cta` for the
button inside it ("Approve the PR", "Check the comments landed"), and a `lane` when the derived one
is wrong. A PR that still has unsubmitted drafts renders **Comment / Approve / Request changes**
instead of the `cta`, since what that card needs back is a resolution, not an instruction to read.
The build prints the exact `title` / `description` / `favicon` / `url` to publish with; pass them
verbatim, and on a first publish record the URL with `dashboard-url --set`.

Then report in chat as well: per PR the `/files` link, what was drafted with one line each, what was
dropped and why, and anything that does not belong on a PR at all. Say explicitly that the review is
unsubmitted and how to submit it.

The page hands feedback back as a pasted block of comments and decisions. Each comment re-enters at
Step 2; a `Do these` line is the reviewer's instruction, and it is the one route by which `submit` is
authorized without them naming the event in chat — `submit them as APPROVE` names it, so run
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
`watch` covers both: it polls **every PR `state.md` has ever recorded** — across repos, including
merged and closed ones, since a thread outlives its merge — for comments landed since the last pass,
and it re-runs the **queue** on a slower interval so a PR whose review was requested after the run
still reaches you.

```bash
node scripts/review-prs.js watch
```

It takes no options. Comments poll every 2 minutes, the queue sweeps every 15, bots never report,
and every PR state is polled — those were knobs once and none of them earned the surface.

- **Its own comments and bots stay out of the report** (`--include-bots` opts them back in), so what
  surfaces is a person waiting on a reply.
- **A high-water mark per PR per surface** lives in `watch-state.json`; the first pass on a PR seeds
  those marks and reports nothing, rather than replaying the whole history.
- **The queue sweep runs every 15 minutes**, not every pass — it re-resolves every review request
  through the PR endpoint, so it costs far more API calls than a comment poll. Only actionable rows
  are reported, keyed on status and head
  SHA, so a PR surfaces again when it is pushed to or moves `needs-draft` → `answered`, and a quiet
  one stays quiet. Unlike the comment marks, the first sweep **does** report — an actionable PR is
  work waiting whether or not this process has seen it before.
- **One unreachable PR is a line of output, not the end of the pass** — a deleted PR or a revoked
  token on one repo leaves the others reporting.

Everything reported re-enters this skill at Step 2 — a comment means read the thread and draft the
reply through `reply`; a `[queue]` line means a full review, Steps 2-4. An answer that closes a
thread is worth saying so in one line; an answer that resolves nothing needs the verification pass
first — a colleague's "I checked and it's fine" is evidence to confirm, not a finding to drop on
trust.

**Done when** every reported comment is either answered with a draft or named as needing nothing,
and every PR the sweep surfaced is drafted on or classified.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The review is drafted; submitting is the obvious next step" | Submitting is the user's call, and it is the only irreversible step here. A draft costs nothing to rewrite. Submit only when told to, with an explicit `--event`. |
| "I'll post this one comment straight to the PR, it's faster" | A published comment cannot be redrafted, and an open pending review makes REST posting fail anyway (422, one pending review per user per PR). Everything goes through `draft`. |
| "I read the diff and know what's wrong — surfaces can wait" | Bots and other reviewers have usually said it already. A duplicate finding wastes the author's time and costs the review its credibility. Read the surfaces first, every run. |
| "The PR is unchanged since the last run, but another look can't hurt" | A matching head SHA in `state.md` means handled. Re-reviewing it re-delivers findings the author already has. |
| "No findings — I should write something so the run isn't empty" | An empty queue or a clean PR is a real result. Say so in one line. |
| "I'll write the status page HTML myself, it's just one page" | The page's markup, themes and behaviour live in `scripts/review-prs-dashboard.js` so every reviewer on this skill gets the same interface and the same fixes. Hand-written HTML is a private one-off that drifts on the next run. Pass data through `--actions`; change the renderer if the page itself is wrong. |
| "It's a nit — the ask is obvious from the label, an `Ask:` line is overhead" | Obvious to you, inferred by the author. "Worth restoring the clause" reads as an observation to file away; `Ask: restore the when-clause` reads as a thread to close. The smaller the finding, the cheaper its ask is to state. |

## Hard rules

- Nothing is submitted without an explicit instruction naming the event.
- Every drafted body carries `[dev-ai]`, so a later run can tell its own comments from a human's.
- Findings are substantiated against the code, or dropped.
