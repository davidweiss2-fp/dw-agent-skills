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

## Usage — dw-pr-ready-skill

Attach or invoke the skill with a full PR link:

```
https://github.com/org/repo/pull/123
```

The skill runs `node scripts/dw-pr-ready-watch.js "<url>"` and loops until the PR needs attention or is ready.

## License

Copyright (c) 2026 David Weiss. All Rights Reserved. See [LICENSE](LICENSE).
