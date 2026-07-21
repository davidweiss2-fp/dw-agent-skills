# Recall workflow

How saved knowledge surfaces and gets verified on use. **Pure read** — recall never writes
(the counter updates below are a separate, confirmed write via the write workflow).

## When to recall

- **On intent** — "how do we run X here", "how did we do Y last time", "what did we decide
  about Z", "do we have notes on …", "remember when …", "save this", "remember this".
- **Proactively before any non-trivial task** — anything with setup steps, a prior
  decision, or a known gotcha. When in doubt on a real task, recall.

## When NOT to recall

Trivial edits: renames, typo fixes, one-line tweaks, formatting-only changes. Skip
recall on work with no reusable prior art.

## Run it

```bash
node scripts/km-recall.js <query words…> \
  [--scope global|project|both]   # default both
  [--limit N]                     # default 5
  [--window-days N]               # suspect window, default 90
  [--json]                        # structured array instead of the advisory block
  [--hook]                        # read {prompt} from stdin JSON (UserPromptSubmit hook)
```

The script reads `*.md` from the chosen store(s), keeps only real memories
(`metadata.type` in the taxonomy, `status` ≠ `superseded`, `confidence` > 0), scores each,
and ranks by **relevance × recency × confidence**.

- **Relevance** — weighted distinct-term overlap (trigger > name/description > recall_conditions).
- **Recency** — fresh within the window = 1.0, decays with age (floored, never dropped).
- **Confidence** — scales but never overwhelms relevance.

Anything past `last_verified + window` is flagged **`[SUSPECT]`** (and a missing date counts
as suspect). Empty query or no overlap → no matches.

## Treat results as ADVISORY

1. Present hits as "saved knowledge that may apply — verify before relying."
2. Resolve `{parameter}` slots from **live context**, not from the stored examples
   (the examples are just hints). Verify a stored command before running it.
3. Re-verify anything flagged `[SUSPECT]` before trusting it.
4. **Empty results → say so plainly; an empty result is a valid answer.**

## Verify-on-use (then update counters)

After you act on a memory, check its `success_signal`:

- **Success** → `use_count += 1`, `success_count += 1`, set `last_verified` = today
  (from context), raise `confidence`.
- **Failure** → `use_count += 1`, `fail_count += 1`, lower `confidence`. If `confidence`
  reaches `0`, it becomes a prune candidate (see `km-review.js`); a wrong procedure may be
  superseded by a corrected one (invalidate-then-add).

These updates are writes — apply them through the write discipline (genericized, scrubbed
if you touch the body, confirmed). Recall itself stays read-only.

## Self-update while you're here

If a recalled memory is incomplete or outdated, enrich it (add the missing
precondition/parameter/step, refresh `last_verified`) rather than leaving it stale. On a
contradiction, supersede the old file and write the corrected one. A verified memory takes
precedence over an unverified guess.
