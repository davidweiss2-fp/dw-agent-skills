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
| `node scripts/review-prs.js queue` | Open review requests, classified against the store (`--json` for machine output) |
| `… surfaces <pr>` | Your pending drafts, your submitted reviews, and every published comment (human and bot) |
| `… threads <pr>` | Review threads with node ids, for replying into an existing thread |
| `… draft <pr> --path P --line N --body-file F` | New draft comment on a diff line; opens the pending review if needed |
| `… reply <pr> --thread ID --body-file F` | Draft reply inside someone else's thread |
| `… edit --comment NODE_ID --body-file F` / `drop --comment NODE_ID` | Rewrite or delete one of your drafts |
| `… submit <pr> --event COMMENT\|APPROVE\|REQUEST_CHANGES` | Publish the pending review — only on explicit instruction |
| `… state-set <pr> --status drafted\|submitted\|declined` | Record the head SHA handled |
| `… log <pr> --status S --weight W --finding TEXT` | Append to the comment ledger |

Store (read at the start, write at the end): `<DW_STORE_ROOT or ~/Documents/dw-agent-store>/run-notes/dw-review-prs/`
— `state.md` (head SHA per PR: same SHA means handled, different SHA means review the delta) and
`comments.md` (every finding ever drafted or submitted).

## Step 1 — Read the queue

`queue` re-resolves every search hit through the PR endpoint, so closed and merged PRs drop out.
Statuses:

| Status | Meaning | Move |
|---|---|---|
| `draft-waiting` | Unsubmitted drafts already sit on the PR | Report the link; the user submits or asks for edits |
| `needs-draft` | No review from you, or pushed to since your last one | Full review, Steps 2-4 |
| `draft-empty` | An empty pending review holds the one-per-PR slot | Draft into it, or `drop` its remnants |
| `reviewed` / `skip` / `closed` | Handled at this head, own PR, or gone | One line, no work |

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

**Done when** each finding is either substantiated with the evidence you'd quote, or dropped.

## Step 4 — Draft one comment per finding

`draft` for a new thread, `reply` to join an existing one. The script refuses a body without the
`[dev-ai]` tag.

- **150 words per comment, 250 with a code block.** Over budget means cut, not rephrase.
- **Finding and ask in the first two lines.** One ask per comment; two findings means two comments.
- **Label the weight** — blocker / please fix / suggestion / nit — and let the label do the framing.
- **Evidence is one line or one short block**: the minimum that lets the author check it themselves.
- **Quote code verbatim** and never elide a list the argument depends on. **Name the unit** — a row,
  a sale, a shopper. **Try to falsify the finding** before drafting: can the state it describes
  actually occur?
- Cut the closing "general rule" paragraph, the inventory of things that turned out fine, and
  anything hedged with "arguably".

For anything at the top of the budget, hand the rendered draft to a subagent with no session context
and ask it to restate the claim; if it cannot, the draft is not ready.

**Done when** every surviving finding is drafted on the PR and nothing is submitted.

## Step 5 — Hand over

Report per PR: the link (the `/files` view), what was drafted with one line each, what was dropped
and why, and anything for the user that does not belong on a PR. Say explicitly that the review is
unsubmitted and how to submit it.

## Step 6 — Close out

`state-set` per PR touched, `log` per drafted comment. Capture anything durable — a repo convention,
a correction to these steps — through `dw-knowledge`.

**Done when** `state.md` carries the head SHA for every PR reviewed this run and `comments.md` has a
row per draft.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The review is drafted; submitting is the obvious next step" | Submitting is the user's call, and it is the only irreversible step here. A draft costs nothing to rewrite. Submit only when told to, with an explicit `--event`. |
| "I'll post this one comment straight to the PR, it's faster" | A published comment cannot be redrafted, and an open pending review makes REST posting fail anyway (422, one pending review per user per PR). Everything goes through `draft`. |
| "I read the diff and know what's wrong — surfaces can wait" | Bots and other reviewers have usually said it already. A duplicate finding wastes the author's time and costs the review its credibility. Read the surfaces first, every run. |
| "The PR is unchanged since the last run, but another look can't hurt" | A matching head SHA in `state.md` means handled. Re-reviewing it re-delivers findings the author already has. |
| "No findings — I should write something so the run isn't empty" | An empty queue or a clean PR is a real result. Say so in one line. |

## Hard rules

- Nothing is submitted without an explicit instruction naming the event.
- Every drafted body carries `[dev-ai]`, so a later run can tell its own comments from a human's.
- Findings are substantiated against the code, or dropped.
