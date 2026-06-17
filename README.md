# dw-agent-skills

David Weiss agent skills — installable for **Cursor** and **Claude Code**.

## Install

```bash
# Cursor
npx -y github:davidweiss2-fp/dw-agent-skills -- --only cursor

# Claude Code
npx -y github:davidweiss2-fp/dw-agent-skills -- --only claude

# Both
npx -y github:davidweiss2-fp/dw-agent-skills -- --only cursor --only claude
```

Or one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/davidweiss2-fp/dw-agent-skills/main/install.sh | bash
```

See [INSTALL.md](INSTALL.md) for details.

## Skills

| Skill | Trigger | What |
|-------|---------|------|
| `dw-pr-ready-skill` | Full PR URL + "keep ready" / babysit | Watches comments, CI, review/draft state, merge queue; updates branch when safe; exits with next action |
| `dw-product-decision-skill` | "ask product about this" / `/dw-product-decision [slack\|jira\|both]` | Reframes a dev question into a product-level decision and drafts a Slack DM + JIRA comment (drafts only, never posts) |

## Usage — dw-pr-ready-skill

Attach or invoke the skill with a full PR link:

```
https://github.com/org/repo/pull/123
```

The skill runs `node scripts/dw-pr-ready-watch.js "<url>"` and loops until the PR needs attention or is ready.

## Usage — dw-product-decision-skill

Invoke when an engineering question needs a product call:

```
/dw-product-decision [slack|jira|both] [optional topic]
```

It reframes the question to product altitude (Context / Scenario / Question / Suggested resolution),
derives the JIRA ticket from the branch, optionally attaches app screenshots (staging or local) for
UI questions, and outputs copy-ready Slack-DM and JIRA-comment drafts with click-to-open links. It
never posts — you paste.

## License

Copyright (c) 2026 David Weiss. All Rights Reserved. See [LICENSE](LICENSE).
