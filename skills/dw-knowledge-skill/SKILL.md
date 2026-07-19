---
name: dw-knowledge-skill
description: >-
  Live cross-project agent memory — capture, recall, update, and prune reusable
  knowledge. Reach for this on ANY non-trivial task. RECALL before doing real
  work — "how do we run X here", "how did we do Y last time", "what did we decide
  about Z", "do we have notes on …". CAPTURE when a generalizable how-to procedure,
  product/domain fact, task/decision context, or gotcha worked and was costly or
  recurring — offer to save it. UPDATE an incomplete or outdated memory when you
  find one. Trigger phrasings: "remember this", "save this", "do we have notes on",
  "update what you know about". Stores the METHOD, never secrets; every candidate
  is genericized and scrubbed, then written automatically when the save-gate passes.
---

# Knowledge Memory

A live, file-based memory you maintain across sessions and projects. Four moves:
**RECALL** before non-trivial work, **CAPTURE** what worked, **UPDATE** what's incomplete,
**PRUNE** what's stale. Prose carries the judgment; the scripts do the deterministic steps.
Run scripts from this skill directory (`node scripts/<name>.js …`).

## What a memory is (and isn't)

A memory is one markdown file with YAML frontmatter (`name`, `description`, `metadata{…}`)
plus an AWM-style step body and a `## Verify` section. Its `metadata.type` is one of:

- **how-to** — a repeatable procedure ("how to run the tests on this repo").
- **domain** — product / business knowledge.
- **task** — task or decision context ("what we decided about Z and why").
- **gotcha** — a workaround or anti-pattern. A *failed* attempt is a gotcha with
  `confidence: 0` ("DON'T do X"), **never** a callable procedure.

It is **not** a place for secrets, one-off trivia, or anything you can't generalize.
See `references/schema.md` for the full schema and a placeholder-only example.

**Recurring shell how-tos → promote to a runbook.** When a `how-to` is a multi-step *shell*
workflow run over and over (CI, tests, typecheck, a verify dance), the next time it recurs hand it
to **`dw-runbook`**: it generalizes the method into one cached, queued, self-cleaning command and
links back to this memory. The method stays here; the runbook is its executable form.

**Capture the workflow how-tos first.** The highest-value memories are how to *operate the repo* —
how to commit / push / open a PR, how to run lint/typecheck/test, the verify-then-ship flow. These
recur every task and are exactly what stops an agent re-deriving them or asking the dev. Whenever
you work one out, capture it (promote the shell parts to `dw-runbook`), then recall it before the
next git/checks/ship step instead of asking.

## Storage: global vs project (decision rule)

- **GLOBAL** (default) - `~/Documents/dw-agent-store/knowledge/` (`INDEX.md` + one `*.md` per memory;
  the store root honors `DW_STORE_ROOT`, and a pre-`dw migrate` install falls back to the
  legacy `~/.claude` layout).
  Use for knowledge that travels across repos.
- **PROJECT-LOCAL** - `~/Documents/dw-agent-store/projects/<slug>/memory/` (managed block inside `MEMORY.md`
  + one `*.md` per memory). Use **only** when the memory references repo paths, branch
  names, or build commands. The `<slug>` is the project cwd with every non-alphanumeric
  char replaced by `-`.

Decide at save time, default global; go project-local only when it's repo-specific.

## When to SAVE (the write gate)

Save **only** when all hold:

1. **Verified success** — it actually worked (you saw the success signal).
2. **Recurrence OR high cost saved** — likely to recur, or it was expensive to figure out.
3. **Generalizable** — survives the genericity test (true beyond this one instance).

If any fails, don't save. Failed attempts are still worth a `gotcha` at `confidence: 0`.

## How to SAVE

When the save-gate passes, **capture directly — no confirmation needed**. The gate + scrub are the
safeguards, not a prompt-for-yes.

1. **Gate** — confirm verified-success AND (recurrence OR high cost) AND generalizable.
2. **Genericize** — replace concrete values with `{parameter}` slots (e.g. `{site}`,
   `example.com`). Apply the genericity test: would this read true in another repo/account?
3. **Scrub** (hard gate) — `node scripts/km-scrub.js --file <candidate.md>`
   (or pipe on stdin). Exit `0` = clean/auto-slotted; **exit `2` = REFUSE, do not write**.
4. **Dedup / supersede** — read the target store first. ADD (new), UPDATE (enrich existing),
   or NOOP (already covered). On contradiction, mark the old file `status: superseded` and
   write the corrected one. An **unverified** candidate NEVER overwrites a **verified** one.
5. **Record** — note the chosen store and that the gate + scrub passed; no user confirmation is
   required (auto-capture).
6. **Write + index** — write the `*.md` file, then `node scripts/km-index.js --scope <scope>`
   to regenerate the index (idempotent). Pass `--now <YYYY-MM-DD>` from context for stable dates.

Full procedure: `references/write-workflow.md`.

## When to RECALL / when NOT

RECALL when the user signals intent ("how do we run X here", "how did we do Y last time",
"what did we decide about Z", "do we have notes on …", "remember when …") OR **proactively
before any non-trivial task** — anything with setup steps, a prior decision, or a known
gotcha. Do **NOT** recall for trivial edits: renames, typo fixes, one-line tweaks, formatting.

## How to RECALL

```bash
node scripts/km-recall.js <query words…> [--scope global|project|both] [--limit N] [--json]
```

Results are ranked by relevance × recency × confidence; anything past
`last_verified + window` (default 90 days) is flagged `[SUSPECT]`. Treat every hit as
**ADVISORY** ("verify before relying") — resolve `{parameters}` from live context, do not
autopilot. Empty results: say so plainly; never invent a memory.

**Verify-on-use:** after acting on a memory, check its `success_signal`. On success bump
`use_count`/`success_count`, refresh `last_verified` (pass today's date from context), and
raise `confidence`; on failure bump `fail_count` and lower `confidence` (0 → prune).

Full protocol: `references/recall-workflow.md`.

## Self-update

When a recalled memory is incomplete or wrong, fix it instead of leaving it stale:

- **Enrich** — add the missing precondition/parameter/step; refresh `last_verified`.
- **Invalidate-then-add** — on a contradiction, set the old file `status: superseded`,
  then write a corrected memory. Don't silently edit the meaning out from under history.
- **Never let unverified overwrite verified** — a guess does not replace a known-good memory.

## Staleness & pruning

```bash
node scripts/km-review.js [--scope global|project|both] [--window-days N]   # report
node scripts/km-review.js --prune                                          # delete confidence-0, rebuild index
```

Reports prune candidates (`confidence 0`), stale memories (past `last_verified + window`),
and near-duplicate groups (suggests the richest to keep). `--prune` deletes only the
`confidence 0` files and regenerates the index. The store layout (one file per memory +
an index file) stays compatible with the `consolidate-memory` skill.

## Optional auto-recall hook

You can wire a `UserPromptSubmit` hook that runs `km-recall.js --hook` and injects an
advisory block when saved knowledge matches the prompt. See `references/recall-hook.md`
for the two branches and a ready-to-paste, ADDITIVE settings snippet.

## Hard rules

- **Never store a literal secret** — store the METHOD, not the data. No credentials, API
  keys, tokens, cookies, connection strings, or org identifiers (account/tenant IDs,
  internal hostnames, customer names, emails, RFC1918 IPs). `km-scrub.js` is the
  deterministic backstop; exit `2` means refuse.
- **Auto-capture when the gate passes** — no confirmation required; the write-gate (verified ·
  recurrence/cost · generalizable) and `km-scrub` are the safeguards against bad writes.
- **Advisory, not authority** — recalled knowledge is a hint; verify on use.
- **Empty means empty** — no match → say so; never fabricate a memory.

---

Capture + summary-first recall patterns inspired by Cabinet
(github.com/hilash/cabinet, MIT); recall protocol + invalidate-then-add adapted from
MemPalace (github.com/MemPalace/mempalace, MIT).
