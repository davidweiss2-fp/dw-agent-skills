# The status page

One published page per reviewer, re-published to the same URL every run. `dashboard` builds the
HTML; the Artifact tool publishes it.

## Who owns what

`scripts/review-prs-dashboard.js` owns the page: markup, both colour themes, and the client
behaviour (select-to-comment, the per-PR button, the copy handoff). Never hand-write the HTML — the
whole point is that every reviewer on this skill gets the same interface, and the only thing that
varies per run is the data below.

## The ownership filter

Above the lane counts sits a three-state side filter - **All / Yours / Theirs** - splitting the queue
on who authored the PR (`mine` on the card). It opens on **All** the first time and on the side you
last chose after that, remembered in the browser. Each one carries its own count, and your own
cards wear a `yours` chip so the All view is scannable without reading author logins. Lanes that
empty out under a filter hide, and a filter matching nothing renders one line saying so.

The side-filter counts are computed over the whole queue on purpose: the lane counts below recompute to
whatever is active, so the filters are the only place the page can tell you what is on the other side.

Four properties are load-bearing and easy to break by accident:

- **The feedback payload ignores the filter.** A decision or comment recorded on a card that is
  now hidden still lands in **Copy comments**, and the sticky bar counts it. A filter is a view;
  the payload is the record of what the reviewer decided. Scoping the payload to visible cards
  drops an instruction with nothing in the output to say it existed. Because that feedback can only
  be read or removed on its own card, the sticky bar carries a **"N PRs hidden by the filter"**
  button whenever some of it is out of view; clicking it returns to All. Without it the reviewer
  copies an instruction they cannot see.
- **Lane counts follow the filter, the feedback count does not.** They count different nouns -
  cards in view versus decisions recorded - and the inconsistency is chosen, not overlooked.
- **The filter has its own storage key**, separate from the feedback state. `Clear` replaces the
  whole feedback object, and clearing comments must not reset which slice the reviewer was reading.
- **The `yours` chip is not a `stateChip`.** That function's concern is the PR's state - drafts
  waiting, approved, conflicting, checks failing - and who wrote the PR is not a state. Folding it
  in there makes `stateChip` a grab bag; it is prepended where the chips row is assembled instead.

An empty queue and an empty side of it are different messages, and the empty queue wins: the server
renders that one, because it is the case it knows for certain, and the client leaves it alone. A
remembered filter therefore never claims the slice is why a page with nothing in it is bare.

Nothing about the filter comes through `--actions`; it is entirely the reviewer's view of data the
model already carries. No run needs to think about it.

**Who owns which part.** `dashboardModel` owns the split itself, the way it owns lanes: it stamps
`side` on every card and emits `sideCounts`, so every number on the page is derived in one place.
The renderer owns only the wording - each side's label and what it says when empty - and the client
owns the view. A new side is therefore added in the model and named in the renderer's `SIDE_META`.

**The client's behaviour is unit-tested**, against the small DOM in `tests/support/mini-dom.mjs`:
`dashboardClient` closes over nothing, so it runs against a fake document with no dependencies.
That suite covers the filtering, the lane counts, persistence and the hidden-feedback cue; the
markup-to-selector contract is asserted separately in `tests/review-prs.test.mjs`, since the mini
DOM is built by hand rather than parsed from the page.

## The actions file

`--actions` takes JSON. One entry per PR key, all fields optional:

```json
{
  "prs": {
    "acme/widget#42": {
      "lane": "needs-you",
      "cta": "Approve the PR",
      "next": "Approve - all three asks are answered and the delta since your review is one line.",
      "notes": ["Approving also accepts the perf handoff to TICKET-1234."]
    }
  }
}
```

| Field | Does |
|---|---|
| `next` | The free-text next step, the one thing the reviewer reads per card. Written by the agent, not derived. |
| `cta` | Short imperative for the button inside the next-step box: "Approve the PR", "Resolve the mentioned comments". Ignored when the PR has unsubmitted drafts - that card renders **Comment / Approve / Request changes** instead, because a resolution is what it needs back. |
| `lane` | `needs-you` / `waiting-author` / `delegated` / `done`. Omit to let the rule below decide. |
| `notes` | Extra lines under the next step, for a caveat the decision depends on. |

Lane when omitted: an unsubmitted draft means `needs-you`, a `declined` store status means
`delegated`, a merged or closed PR means `done`, anything else is `waiting-author`.

The build reports any PR with no `next` and any with no `cta`, because a card missing either is one
the reviewer cannot act on.

## Publishing

The build prints the exact identity to publish with — `title`, `description`, `favicon`, and the
stored `url`. Pass them verbatim: a title or favicon that moves between runs reads as a different
page in the browser tab and the artifact gallery. On the first publish there is no stored URL, so
record the one you get:

```bash
node scripts/review-prs.js dashboard-url --set https://claude.ai/code/artifact/<id>
```

Every later run reads it back and publishes over the same link, so the reviewer's bookmark holds.
The URL lives in `dashboard.json` beside the rest of the store.

## Across runs, sessions, and users

- **Every run against the same store updates the same page** — a later session, another terminal, or
  the scheduled hourly task all read the URL out of `dashboard.json` and publish over it. Passing
  that URL is what makes it an update; a run that omits it mints a second page and the reviewer's
  bookmark goes stale.
- **One page per reviewer, not one page globally.** Another person installing this skill starts with
  no `dashboard.json`, so their first run publishes their own page under their own account, and their
  runs update that. Artifacts can only be updated by the account that owns them, so this is the only
  shape available — and the right one, since the queue is per-reviewer. The interface is identical
  because the renderer ships with the skill.
- **A run that cannot publish still builds.** The HTML is written by the script; only the publish
  step needs the Artifact tool. In a headless or unauthenticated run, keep the built file, say
  plainly that the page was not refreshed, and report in chat instead.
- **Carry the live page's `next` and `notes` forward.** Everything else on a card is derived from
  the store, but those two are written by the run that touched that PR. A later run that builds a
  fresh `actions.json` from its own work therefore strips them off every card it did not touch, and
  those cards are the ones the reviewer reads to decide what is still waiting. Fetch the published
  page, merge its per-PR `next` and `notes` into this run's actions, then publish.
- **A publish conflict is otherwise safe to overwrite.** Nothing on the page is hand-edited, so once
  the merge above is done, rebuild and publish again rather than reconciling.

## The way feedback comes back

The page cannot reach GitHub, so its buttons record instructions rather than performing them. The
reviewer selects text on any card, comments on it, clicks the per-PR button, then **Copy comments**
and pastes the result into the run:

```
## Review queue feedback - <timestamp>

### Do these
- acme/widget#42 -> I read the drafts - submit them as APPROVE
- acme/widget#43 -> Approve the PR

### Comments
- acme/widget#42 - on "the quoted text"
  what they want done about it
```

A `submit them as <EVENT>` line names the review event, so it authorizes exactly
`submit <pr> --event <EVENT>` on that PR - one submit, no other resolution inferred.

Each pasted comment re-enters the skill at Step 2: read the thread, check the claim against the
code, draft the reply. A `Do these` line is an instruction from the reviewer — including `submit`,
which is the one case where publishing a review is authorized without them naming the event in chat.
