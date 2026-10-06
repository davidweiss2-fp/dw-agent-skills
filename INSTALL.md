# Install dw-agent-skills

## Requirements

- Node.js >= 18
- GitHub CLI (`gh`) authenticated - required by `dw-pr-ready-skill`

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

- **Other agents** - `npx -y skills add davidweiss2-fp/dw-agent-skills --all`, then the claude-code copy is removed (Claude uses the plugin below)
- **Claude Code** - `claude plugin marketplace add davidweiss2-fp/dw-agent-skills` then `claude plugin install dw-agent-skills@dw-agent-skills`

## Flags

| Flag | What |
|------|------|
| `--dry-run` | Print commands, write nothing |
| `--force` | Reinstall even if present |
| `--only <id>` | `claude` or `agents` (`cursor` accepted as an alias for `agents`) |
| `--hooks` / `--no-hooks` | Wire agent hooks (default: on) |
| `--list` | Show providers and skills |
| `--uninstall` | Remove Claude plugin and dw hook entries |

## Hooks

The plugin ships one hook dispatcher (`bin/dw-hook.js`) wired to two events in
`hooks/hooks.json`: SessionStart and PreCompact. SessionStart injects the knowledge
indexes once per session. PreCompact injects a handoff nudge only when the session is
about to be summarized. Prompt recall, runbook hints, and per-tool recall stay in the
dispatcher for a hand-wired hook, and are not registered, because firing them on every
prompt or tool call burns tokens. PreCompact has no `hookSpecificOutput` branch, so its
nudge travels as `systemMessage` alone.

- **Claude Code as a plugin** - the plugin registers these itself on enable; the installer
  changes no settings.
- **Claude Code without the plugin** - the installer merges the same entries into
  `~/.claude/settings.json` additively: it appends to each event array, dedupes by exact
  command string, and never touches foreign entries.
- **Cursor / Codex / Windsurf** - no settings-file hooks today; the installer prints the manual
  wiring docs (`dw-knowledge-skill/references/recall-hook.md`,
  `dw-runbook-skill/references/hook.md`, and the nudge script path).

Pass `--no-hooks` to skip wiring. `--uninstall` removes exactly the entries the installer added.

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
