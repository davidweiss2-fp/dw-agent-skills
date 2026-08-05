# What the queue looks in

`queue` unions several searches and merges them by PR, so one PR can arrive from more than one source.
Every search runs `--state=open --archived=false --sort updated --order desc --limit 100`.

| Source | Aged out by `--days`? | Why |
|---|---|---|
| `review-requested:@me` | **no** | An unanswered request is work however long it has sat. |
| `review-requested:<team>` for each team from `/user/teams` | **no** | A request nobody has claimed individually is invisible otherwise. |
| `reviewed-by:@me` | yes | Otherwise "I reviewed this once" reaches back years. |
| `mentions:@me` | yes | Being named is a request for attention, not for a review. |
| `commenter:@me` | yes, and only with `--participation` | Taking part in a thread is the loosest signal here. |

GitHub clears the review request the moment a review is submitted, which is exactly when the reviewer
starts waiting on the author - so a request-only queue drops the PR at the worst possible moment. That
is what `reviewed-by:@me` is for.

## Teams come from the API

Resolved per run through `/user/teams`, never configured, so this skill carries no one's team names
and works for whoever installs it. A token without the org scope returns nothing, which costs one
source rather than the run.

## Discovery is windowed; retention is not

`--days N` (default 14, `--all-time` to disable) prunes only the windowed sources. Independently,
every PR the store records as `drafted` is added back whatever its age, because those carry
unsubmitted drafts and must never fall off the list. A retained PR that has since closed reports how
to clear it (`state-set`) instead of repeating a dead line every run.

`assignee:@me` was measured and rejected: on a real queue it returned only the reviewer's own PRs and
dependabot chores.
