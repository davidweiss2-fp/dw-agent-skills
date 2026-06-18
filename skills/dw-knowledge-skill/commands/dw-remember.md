---
name: dw-remember
description: Capture a reusable, verified, generalizable fact or procedure into memory.
---

# /dw-remember

Drive the capture workflow to save reusable knowledge. Auto-suggest a capture when the
gate passes, but **always confirm before writing**.

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
6. **Confirm** — show the genericized + scrubbed candidate and the chosen store; wait for yes.
7. **Write + index** — write the `*.md` (frontmatter per `references/schema.md`), then:

   ```bash
   node scripts/km-index.js --scope <global|project|both> [--now YYYY-MM-DD]
   ```

Full procedure: `references/write-workflow.md`.

## Hard rules

- Never store a literal secret — store the METHOD, not the data. `km-scrub.js` exit `2` = refuse.
- Always confirm before writing — auto-suggest, never auto-save.
- The skill repo ships ZERO real memories — examples use placeholders only (`{site}`, example.com).
