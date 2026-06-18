---
name: dw-handoff
description: Compress this session into a clean, secret-scrubbed handoff document for the next agent.
---

# /dw-handoff

Write a self-contained handoff document for the current session so a fresh agent can continue cold.

## Invocation

`/dw-handoff [optional: what the next session will focus on]`

A focus argument becomes the next session's objective — bias **Next steps** and **Suggested next
skills** toward it. No argument: hand off the work as it stands.

## Flow

1. **Get the path** — from this skill directory:

   ```bash
   node scripts/dw-handoff-path.js [--focus "next-session focus"]
   ```

   It prints an absolute temp-dir path (never the working tree) and a section skeleton on stderr.
2. **Fill the document** — state first: Objective, Current state, Next steps (ordered, concrete,
   most-important first), Key decisions & constraints, Gotchas, Pointers, Suggested next skills.
   Drop empty sections; don't pad.
3. **Reference, don't recreate** — link PRDs / plans / ADRs / tickets / PRs / diffs by path or URL
   instead of restating them.
4. **Scrub** (hard gate) — reuse the dw-knowledge-skill scrubber, don't reimplement it:

   ```bash
   node ../dw-knowledge-skill/scripts/km-scrub.js --file <handoff.md>
   ```

   Exit `0` = write the scrubbed text as final. **Exit `2` = REFUSE: remove the secret by hand and
   re-run.** See `references/redaction.md`.
5. **Hand it over** — give the user the absolute path. The document is the deliverable.

## Hard rules

- Temp dir, never the working tree — a handoff must not appear in `git status`.
- Scrub before finalizing; exit `2` means fix and re-run, never ship.
- Reference existing artifacts; don't recreate them.
- Suggest only skills you can confirm are installed — never fabricate names.
