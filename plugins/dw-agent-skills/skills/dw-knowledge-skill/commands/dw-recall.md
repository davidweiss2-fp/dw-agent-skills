---
name: dw-recall
description: Recall saved knowledge that may apply before doing non-trivial work.
---

# /dw-recall

Search the knowledge-memory store and surface saved knowledge that may apply, as
**advisory** guidance. Read-only — never writes.

## Invocation

`/dw-recall [query words…] [--scope global|project|both] [--limit N]`

If no query is given, infer one from the current task/conversation (what is the user
about to do?). Default scope is `both`.

## Flow

1. Build a query from the user's words, or from the task at hand if none were given.
2. From this skill directory, run:

   ```bash
   node scripts/km-recall.js <query words…> [--scope global|project|both] [--limit N]
   ```

   Add `--json` if you need to act on the structured results programmatically.
3. Present the ranked hits as **advisory** — "saved knowledge that may apply, verify
   before relying." Resolve any `{parameter}` slots from live context; do not autopilot.
4. Honor the `[SUSPECT]` flag (past `last_verified + window`): re-verify before trusting it.
5. If results are empty, say so plainly. **Never invent a memory.**
6. After you act on a memory, do verify-on-use: check its `success_signal`, then update
   counters / `last_verified` / `confidence` (see `references/recall-workflow.md`).

## Hard rules

- Advisory, not authority — recalled knowledge is a hint; verify on use.
- Empty means empty — no match → say so; never fabricate.
- Read-only — `/dw-recall` never writes; use `/dw-remember` to capture.
