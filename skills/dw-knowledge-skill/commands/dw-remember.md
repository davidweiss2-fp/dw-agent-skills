---
name: dw-remember
description: Capture a reusable, verified, generalizable fact or procedure into memory.
---

# /dw-remember

Drive the capture workflow to save reusable knowledge. When the gate passes, capture
directly — no confirmation needed.

## Invocation

`/dw-remember [what to remember]`

If no text is given, infer the candidate from what just worked in this session.

## Flow

1. **Gate** — save only if it is verified-success AND (recurrence OR high cost saved) AND
   generalizable. If any fails, don't save (a failed attempt → a `gotcha` at `confidence: 0`).
2. **Pick type & scope** — `type` ∈ how-to | domain | task | gotcha. Default scope
   **global**; go **project** only if it references repo paths / branches / build commands.
3. **Genericize** — replace concrete values with `{parameter}` slots (e.g. `{site}`,
   `example.com`). Apply the genericity test.
4. **Scrub** (hard gate) — write the candidate to a temp file, then:

   ```bash
   node scripts/km-scrub.js --file <candidate.md>
   ```

   Exit `0` = use the scrubbed text. **Exit `2` = REFUSE — do not write.**
5. **Dedup / supersede** — read the target store first. ADD / UPDATE / NOOP. On a
   contradiction, mark the old file `status: superseded` and write the corrected one.
   An unverified candidate never overwrites a verified one.
6. **Write + index** — once the gate passes and scrub succeeds, write proceeds
   automatically (no yes/no prompt). Write the `*.md` (frontmatter per
   `references/schema.md`), then:

   ```bash
   node scripts/km-index.js --scope <global|project|both> [--now YYYY-MM-DD]
   ```

Full procedure: `references/write-workflow.md`.

## Hard rules

- Never store a literal secret — store the METHOD, not the data. `km-scrub.js` exit `2` = refuse.
- Auto-capture when the gate passes — no confirmation required; the gate + scrub are the safeguards.
- The skill repo ships ZERO real memories — examples use placeholders only (`{site}`, example.com).
