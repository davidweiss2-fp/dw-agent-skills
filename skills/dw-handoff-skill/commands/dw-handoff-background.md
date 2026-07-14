---
name: dw-handoff-background
description: Hand this session off to a live background agent, seeded with the same scrubbed handoff.
---

# /dw-handoff-background

Explicit, opt-in only. Produces the same scrubbed handoff document as `/dw-handoff`, then spawns a
background agent seeded with it instead of only saving it. Never fires on its own - only on this
command or a plain ask to hand off to / continue in a background agent.

## Invocation

`/dw-handoff-background [optional: what the next session will focus on]`

Same argument semantics as `/dw-handoff`: a focus argument becomes the next session's objective.

## Flow

1. **Build the handoff** - steps 1-4 of `/dw-handoff`: derive the path (`dw-handoff-path.js`), fill
   the document, reference rather than recreate existing artifacts, and run it through
   `km-scrub.js`. Exit `2` = refuse and fix by hand, never proceed. Write the scrubbed text to the
   derived temp path - it stays a durable artifact even though a live agent also gets a copy.
2. **Spawn the background agent** - one `Agent` tool call, `run_in_background: true`, prompt built
   from the scrubbed document plus the boundary list and framing in
   `../references/background-mode.md`. Give it a short, descriptive title.
3. **Tell the user** - one or two lines: a background agent was spawned, its title, and that
   they'll be notified when it completes or can check on it the normal way in this environment. No
   invented tracking mechanism.

## Hard rules

- Opt-in only - this mode never runs without an explicit trigger.
- Same scrub gate as `/dw-handoff`; exit `2` means fix and re-run, never ship or hand off.
- The seed prompt states what the background agent must not do without asking (see
  `../references/background-mode.md`).
- Real notification mechanism only - never fabricate a tracking UI or status file.
