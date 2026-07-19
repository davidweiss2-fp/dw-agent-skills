# Write workflow

How a verified, generalizable fact becomes a stored memory. When the gate passes, the
write proceeds automatically. Run scripts from the skill directory.

## 1. Gate

Save **only** when all three hold:

- **Verified success** — you observed it working (the success signal fired).
- **Recurrence OR high cost saved** — it will likely recur, or it was expensive to derive.
- **Generalizable** — true beyond this single instance.

If any fails: don't save. A failed attempt is still worth a `gotcha` at `confidence: 0`
("DON'T do X") so you don't repeat it — but never write a failed path as a callable how-to.

## 2. Choose type & scope

- `type` ∈ `how-to` | `domain` | `task` | `gotcha` (see `schema.md`).
- **Scope** - default **global** (`~/Documents/dw-agent-store/knowledge/`). Go **project**
  (`~/Documents/dw-agent-store/projects/<slug>/memory/`) **only** when the memory references repo paths,
  branch names, or build commands. Decide at save time.

## 3. Genericize

Replace concrete values with `{parameter}` slots and declare each in `metadata.parameters`
as `{name, example}`. Use neutral placeholders: `{site}`, `example.com`, `{account_id}`.
**Genericity test:** would this read true in another repo / account / tenant? If not, keep
genericizing or don't save it.

## 4. Scrub (HARD GATE)

```bash
node scripts/km-scrub.js --file <candidate.md>      # or: … < candidate.md
node scripts/km-scrub.js --file <candidate.md> --json   # structured report on stdout
```

- **Exit `0`** — clean, or every match was auto-slotted (e.g. a token → `{api_key}`,
  an internal host → `{host}`). Use the **scrubbed** text that the script emits.
- **Exit `2`** — REFUSE. At least one secret (e.g. a private key block) could not be
  safely genericized. **Do not write.** Fix the candidate by hand and re-scrub.

The scrubber is deterministic and offline. It is a backstop, not a license to paste
secrets — store the METHOD, never the data.

## 5. Dedup / supersede (read-before-write)

Read the target store first and decide:

- **ADD** — nothing similar exists → write a new file.
- **UPDATE** — a memory already covers this but is thinner → enrich it (add the missing
  precondition/parameter/step), bump `last_verified`.
- **NOOP** — already fully covered → don't write.
- **Contradiction** — the new knowledge contradicts an existing memory → mark the old
  file `status: superseded` and write a corrected memory (invalidate-then-add).

**An unverified candidate NEVER overwrites a verified memory.** A guess does not replace
known-good knowledge.

Once the gate passes and scrub succeeds, the write proceeds automatically — no yes/no
prompt.

## 6. Write + index

- Write the `*.md` file into the chosen store (filename = kebab-cased `name`).
- Regenerate the index (idempotent):

  ```bash
  node scripts/km-index.js --scope <global|project|both> [--now YYYY-MM-DD] [--window N]
  ```

  Pass `--now` with today's date from context for a stable, reproducible run. Global
  rewrites `INDEX.md`; project rewrites only the managed block in `MEMORY.md`.

## Counters at write time

New memory: `confidence: 2`, `use_count: 0`, `success_count: 0`, `fail_count: 0`,
`status: active`, `last_verified` = today (from context). Recall later updates these via
verify-on-use (see `recall-workflow.md`).
