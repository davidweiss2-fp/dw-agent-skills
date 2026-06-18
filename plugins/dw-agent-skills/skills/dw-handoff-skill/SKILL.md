---
name: dw-handoff-skill
description: >-
  Compress the current work session into a clean handoff document — what was
  done, where things stand, and the exact next steps — so a fresh agent (or a
  human picking up tomorrow) can continue without re-deriving context. SCRUBS
  secrets before writing and ends with a suggested-next-skills section. Use when
  the user is wrapping up, running low on context, switching agents, or says
  "write a handoff", "hand this off", "summarize where we are for the next
  session", "compact this for a fresh agent", or invokes /dw-handoff [focus for
  the next session].
disable-model-invocation: true
---

# Session Handoff

Your job: turn everything that happened in this session into a **single, self-contained handoff
document** a fresh agent can read cold and keep working — no access to this conversation required.
This is prompt-driven; you do the summarizing. One small script scaffolds the file path, and
secret redaction is delegated to the `dw-knowledge-skill` scrubber (see Redaction below).

## Invocation

`/dw-handoff [optional: what the next session will focus on]`

If a focus argument is given, treat it as the next session's objective and bias the **Next steps**
and **Suggested next skills** sections toward it. With no argument, hand off the work as it stands.

## Where it goes

Write to the OS temp dir, **never** the working tree — a handoff is scratch, not a tracked artifact
that pollutes `git status`. Get a stable, collision-free path from the scaffold script:

```bash
node scripts/dw-handoff-path.js [--focus "next-session focus"]
```

It prints an absolute `.md` path under the system temp dir (e.g.
`/tmp/dw-handoff/<branch-or-slug>-<date>.md`) and a starter skeleton on stderr. Write your document
there, then give the user the path.

## What goes in the document

Lead with the state, not a narrative. A good handoff answers "what do I do next?" in the first
screen. Use these sections (drop any that are empty — don't pad):

1. **Objective** — the one-line goal of the work, plus the next-session focus if one was given.
2. **Current state** — what's true *right now*: what works, what's half-done, what's broken, what's
   been verified vs. assumed. Name the branch and whether changes are committed/pushed.
3. **Next steps** — an ordered, concrete checklist. Each item is an action a fresh agent can take
   without guessing. Put the single most important next action first.
4. **Key decisions & constraints** — choices already made and *why*, so the next agent doesn't
   relitigate them or violate a constraint it can't see.
5. **Gotchas** — traps hit this session: flaky commands, wrong turns, environment quirks. Save the
   next agent the time you already spent.
6. **Pointers** — paths, URLs, ticket/PR links, commands to run. Reference existing artifacts; do
   **not** recreate them (see below).
7. **Suggested next skills** — name the skills the next agent should reach for, each with a one-line
   why (see below).

Keep it tight. A handoff is a launch pad, not a transcript — favor the few facts that unblock work
over a complete record.

## Don't duplicate existing artifacts

If the content already lives somewhere durable — a PRD, plan, ADR, JIRA ticket, PR description,
commit message, or a `git diff` — **link or path to it instead of restating it.** Re-pasting drifts
out of date the moment the source changes. The handoff's job is to point and to add what *isn't*
already written down.

## Redaction (hard gate — run before you finalize)

A handoff summarizes real work, so it can easily pick up tokens, connection strings, internal
hostnames, account IDs, or emails. Do **not** ship those. Reuse the `dw-knowledge-skill` scrubber
rather than duplicating redaction logic here — it is the deterministic, `node:`-only backstop:

```bash
node ../dw-knowledge-skill/scripts/km-scrub.js --file <handoff.md>
```

(If the skills are installed side by side, the relative path above resolves; otherwise pass the
absolute path to that script.) Exit `0` = use the scrubbed text (secrets auto-slotted to
`{api_key}`, `{host}`, `{account_id}`, …). **Exit `2` = REFUSE: a secret could not be safely
genericized — remove it by hand and re-run.** Write the scrubbed text as the final document. See
`references/redaction.md` for what gets caught and the no-network/no-duplicate rationale.

## Suggested next skills

End the document with a short list of skills the next agent should consider, each one line:
`- dw-pr-ready-skill — babysit the open PR until it's mergeable.` Pick from what's actually
installed and relevant to the **Next steps**; if a next-session focus was given, weight toward it.
Don't invent skill names — list only ones you can confirm exist. For git safety when wrapping up,
a good one to suggest is **dw-git-guardrails-skill** — it installs a `PreToolUse` hook that blocks
destructive git commands so a fresh agent can't wipe unsaved work.

## Hard rules

- **Temp dir, never the working tree** — a handoff must not show up in `git status`.
- **Scrub before finalizing** — run `km-scrub.js`; exit `2` means refuse and fix, never ship.
- **Reference, don't recreate** — link PRDs/plans/diffs/tickets by path or URL.
- **State first, narrative last** — the first screen must answer "what do I do next?".
- **Only real skills** — suggest skills you can confirm are installed; never fabricate names.

---

Adapted from mattpocock/skills (skills/productivity/handoff), MIT License. Re-expressed for this
repo; redaction is delegated to dw-knowledge-skill rather than reimplemented.
