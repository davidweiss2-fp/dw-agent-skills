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
  the next session]. Has an explicit opt-in background mode - only when the
  user says "hand this off to a background agent" / "keep working on this in
  the background" or invokes /dw-handoff-background - that seeds a live
  background agent with the same scrubbed handoff instead of only saving it.
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

## Auto-nudge (plugin installs)

Installed as the Claude Code plugin, a `PreCompact` hook (`scripts/dw-handoff-nudge.js`) fires just
before the session compacts - auto or manual - and points the agent back at this skill: write the
handoff to the derived path and persist any active dw-flow state to the worktree context dir before
conversation detail is lost. Advisory only - it always exits 0 and never blocks compaction. Verify
it any time: `node scripts/dw-handoff-nudge.js --self-test`.

## Where it goes

Write to the OS temp dir, **never** the working tree — a handoff is scratch, not a tracked artifact
that pollutes `git status`. Get a stable, idempotent path from the scaffold script — it's keyed by
branch + date, so a same-branch, same-day re-run intentionally resolves to the same path and
overwrites the previous handoff:

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
Don't invent skill names — list only ones you can confirm exist. For git when wrapping up, a good
one to suggest is **dw-git-ops-skill** — the suite's git owner (worktree-first flow, with
destructive git judged and run raw rather than blocked).

## Background mode - hand off to a live agent instead of only a file

This mode produces the same scrubbed handoff as above, then hands it to a background agent that
keeps working while you do something else. It never replaces the default flow - it adds a delivery
option for the same document.

**Opt-in only, never inferred.** Run this mode only on an explicit trigger: `/dw-handoff-background
[focus]`, or the user plainly asking to hand off to / continue in a background agent. A wrap-up
request alone ("write a handoff", low context, switching agents) stays the default file-only flow.
Spawning a background agent spends compute and can take further actions on its own, so, like this
repo's other autonomous-action skills (no auto-posting, no unrequested prod mutations), the decision
to start one is never made silently on the user's behalf.

1. Do steps 1-4 of the default flow unchanged: derive the path, fill the document, reference rather
   than recreate existing artifacts, and run it through `km-scrub.js` (exit `2` still means refuse
   and fix by hand). Write the scrubbed text to the derived temp path - it stays a durable, referable
   artifact even though a live agent is also getting a copy.
2. Spawn one background agent seeded with that scrubbed text, in this environment via the `Agent`
   tool with `run_in_background: true` (this environment's equivalent of upstream's `claude --bg`) -
   never edit the working tree directly to “continue the work” in this mode. Give it a short,
   descriptive title (mirrors upstream's required `--name`), so the user can tell it apart from other
   background work. The prompt is self-contained: repo path, the focus/next-steps, explicit
   boundaries on what it must not do without asking, and pointers to PRDs/tickets/PR/diffs by path or
   URL - never re-paste their content. Full prompt template and the boundary list:
   `references/background-mode.md`.
3. Tell the user, in one or two lines: a background agent was spawned, its title, and that they'll
   be notified when it completes or can check on it through this environment's normal background-task
   mechanism. Don't invent a tracking dashboard or status file this repo doesn't provide.

## Hard rules

- **Temp dir, never the working tree** — a handoff must not show up in `git status`.
- **Scrub before finalizing** — run `km-scrub.js`; exit `2` means refuse and fix, never ship.
- **Reference, don't recreate** — link PRDs/plans/diffs/tickets by path or URL.
- **State first, narrative last** — the first screen must answer "what do I do next?".
- **Only real skills** — suggest skills you can confirm are installed; never fabricate names.
- **Background mode is opt-in only** - spawn a background agent solely on an explicit trigger
  (`/dw-handoff-background` or a plain ask); never as a silent default.
- **Boundaries travel with the prompt** - the background agent's seed prompt must state what it may
  not do without asking (see `references/background-mode.md`); never hand off a bare summary.
- **Real notification mechanism only** - tell the user how this environment actually surfaces a
  finished background agent; never fabricate a tracking UI.

---

Adapted from mattpocock/skills (skills/productivity/handoff), MIT License. Re-expressed for this
repo; redaction is delegated to dw-knowledge-skill rather than reimplemented. Background mode is
adapted from the same upstream's `claude-handoff` skill (`skills/in-progress/claude-handoff`, PR #421,
merged 2026-07-02), which hands its summary to `claude --bg` instead of saving it - re-expressed here
as a mode of this skill (rather than a separate one) so the shared redaction/reference/suggested-skills
rules aren't duplicated, and mapped onto this environment's `Agent` tool with `run_in_background: true`.
