---
name: dw-team-communication
description: Turn a change, decision, or status into copy-ready Slack/JIRA/channel drafts, tone-matched to the audience - drafts only.
---

# /dw-team-communication

Turn an engineering change, decision, or status into the right message for the right
audience — to get approval, announce, inform, or loop people in. Prompt-driven; no scripts.

## Invocation

`/dw-team-communication [audience/channel] [free-text intent] [optional topic]`

- `audience/channel` — `slack` / `jira` / `both` / a channel name. No arg ⇒ `both`.
- `free-text intent` — what the message needs to accomplish, e.g. "ask PM to approve",
  "announce to #eng", "status update for the team", "get sign-off on this". No intent given ⇒
  inferred from context and confirmed in one line.
- `--staging` / `--local` — force screenshot source (UI/UX topics only).
- `--no-image` — skip screenshots.
- Anything else — the topic the message is about.

Full engine: this skill's `SKILL.md`.
