# Memory file schema

One markdown file per memory. YAML frontmatter carries the recall key + metadata; the
body carries AWM-style steps and a mandatory `## Verify` section. The store also keeps an
index file (global: `INDEX.md`; project: `MEMORY.md`) with one line per memory -
regenerated in full by `km-index.js` from the files on disk rather than by hand.

The format is Claude's native memory format, deliberately (see the storage section of
`SKILL.md` for the layout): frontmatter is `name` + `description` + `metadata{…}`, and an
index line's `- [name](file.md) - description` prefix is exactly a native index line, with
` · type:… · conf:… · verified:…` facets appended. Unknown `confidence` / `last_verified`
are omitted rather than rendered as `?`.

## Frontmatter

| Field | Meaning |
|---|---|
| `name` | Short human title (also the filename stem, kebab-cased). |
| `description` | The recall key — what this memory is about, in one line. |
| `metadata.node_type` | Always `memory` (keeps `consolidate-memory` compatibility). |
| `metadata.type` | Taxonomy: `how-to` \| `domain` \| `task` \| `gotcha`. Native types (`user`, `feedback`, `project`, `reference`) are also read and indexed - see below. |
| `metadata.scope` | `global` \| `project`. |
| `metadata.trigger` | Phrasings/intents that should surface this (highest recall weight). |
| `metadata.recall_conditions` | Broader situations where this applies. |
| `metadata.preconditions` | List — what must be true before the steps apply. |
| `metadata.parameters` | List of `{name, example}` — the `{slots}` the body uses. |
| `metadata.expected_outcome` | What you should get if it worked. |
| `metadata.success_signal` | The observable check for verify-on-use (mirrors `## Verify`). |
| `metadata.failure_signals` | List — observable signs it did NOT work. |
| `metadata.source` | Where it came from (session, doc, command). No secrets. |
| `metadata.last_verified` | `YYYY-MM-DD` — last time it was confirmed to work. |
| `metadata.use_count` | Times recalled-and-acted-on. |
| `metadata.success_count` | Verify-on-use successes. |
| `metadata.fail_count` | Verify-on-use failures. |
| `metadata.confidence` | Starts at `2`; raised on success, lowered on failure; **prune at `0`**. |
| `metadata.status` | `active` \| `superseded`. |

Rules: a **failed attempt** is a `gotcha` with `confidence: 0` ("DON'T do X"), never a
callable procedure. `confidence` starts at `2`. Dates come from context - record the
context-supplied date at authoring time.

### Type: prefer the four dw values

Write `how-to` / `domain` / `task` / `gotcha`. They carry a distinction the recall protocol
depends on - a `gotcha` is an anti-pattern to avoid, a `how-to` is a procedure to run, and
collapsing them loses the difference at exactly the moment it matters. Memories written by
native memory use `user` / `feedback` / `project` / `reference` instead; those are read and
indexed as-is, and map back as `reference`→`domain`-or-`how-to`, `project`→`task`,
`user`/`feedback`→a preference (no dw equivalent; keep the native value). When you touch
such a memory for another reason, move it to a dw value if the fit is obvious; a
type-only rewrite across the store is churn.

## Body

Ordered AWM-style steps, each as `(intent) … -> (action) <parameterized>`, then a
`## Verify` section that mirrors `success_signal`.

## Example memory (placeholders only — no real data)

```markdown
---
name: Run the dashboard test suite
description: How to run the front-end test suite for a dashboard-style repo
metadata:
  node_type: memory
  type: how-to
  scope: project
  trigger: how do we run the tests here; run the test suite; npm test
  recall_conditions: before changing code that has unit coverage; pre-PR checks
  preconditions:
    - dependencies installed ({install_cmd} has run)
    - node available on PATH
  parameters:
    - name: install_cmd
      example: npm ci
    - name: test_cmd
      example: npm test
  expected_outcome: test runner exits 0 with a green summary
  success_signal: "exit code 0 and a 'passing' summary line"
  failure_signals:
    - non-zero exit code
    - "missing dependency / module not found"
  source: project session
  last_verified: 2026-06-18
  use_count: 0
  success_count: 0
  fail_count: 0
  confidence: 2
  status: active
---

1. (intent) ensure deps are present -> (action) run <{install_cmd}>
2. (intent) run the suite -> (action) run <{test_cmd}> from the repo root
3. (intent) read the result -> (action) check the exit code and summary line

## Verify

Command exits 0 and prints a passing summary. A non-zero exit or "module not found"
means the precondition (deps installed) was not met — re-run {install_cmd} first.
```

The example uses only generic placeholders (`{install_cmd}`, `{test_cmd}`, `example.com`).
Keep real hosts, tokens, account IDs, emails, and customer names out of a memory - use placeholders only.
