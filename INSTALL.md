# Install dw-agent-skills

## Requirements

- Node.js >= 18
- GitHub CLI (`gh`) authenticated — required by `dw-pr-ready-skill`

## Quick install

**macOS / Linux / WSL**

```bash
curl -fsSL https://raw.githubusercontent.com/davidweiss2-fp/dw-agent-skills/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/davidweiss2-fp/dw-agent-skills/main/install.ps1 | iex
```

## Targets

| Target | Command |
|-------|---------|
| **Everywhere** | `npx -y github:davidweiss2-fp/dw-agent-skills` |
| **Other agents** (Cursor, Codex, Windsurf, …) | `npx -y github:davidweiss2-fp/dw-agent-skills -- --only agents` |
| **Claude Code** | `npx -y github:davidweiss2-fp/dw-agent-skills -- --only claude` |

Under the hood:

- **Other agents** — `npx -y skills add davidweiss2-fp/dw-agent-skills --all`, then the claude-code copy is removed (Claude uses the plugin below)
- **Claude Code** — `claude plugin marketplace add davidweiss2-fp/dw-agent-skills` then `claude plugin install dw-agent-skills@dw-agent-skills`

## Flags

| Flag | What |
|------|------|
| `--dry-run` | Print commands, write nothing |
| `--force` | Reinstall even if present |
| `--only <id>` | `claude` or `agents` (`cursor` accepted as an alias for `agents`) |
| `--list` | Show providers and skills |
| `--uninstall` | Remove Claude plugin |

## Verify

```bash
node bin/install.js --list
node bin/install.js --dry-run --only agents
```

After install, invoke `dw-pr-ready-skill` with a full PR URL.

## Uninstall

```bash
npx -y github:davidweiss2-fp/dw-agent-skills -- --uninstall
```

Removes the Claude Code plugin. Skills installed via `npx skills add` are managed by the skills CLI / Cursor skill manager.
