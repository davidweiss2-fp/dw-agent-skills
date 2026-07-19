# Deterministic deslop rules

The rules pass (`scripts/deslop-rules.js`) applies find/replace rules to the lines this
branch introduced - never to unchanged code. It is the mechanical half of deslop: the same
edit every run, no judgment. The judgment half stays in the skill body.

## Rule schema

```json
{
  "name": "em-dash-to-hyphen",
  "description": "what it normalizes and why",
  "appliesTo": ["**/*"],
  "find": "[—–]",
  "flags": "g",
  "replace": "-",
  "enabled": true
}
```

- `name` - unique; a user rule with the same name overrides a shipped default.
- `appliesTo` - globs (`*.md`, `**/*.ts`, `**/*` for everything). Default is all files.
- `find` / `flags` - a JavaScript `RegExp` source and flags.
- `replace` - the replacement string (`$1` backrefs allowed).
- `enabled` - set `false` to keep a rule on disk but skip it.

## Where rules live

- **Shipped defaults:** `references/rules.default.json` (ships `em-dash-to-hyphen`).
- **Your rules:** `~/Documents/dw-agent-store/knowledge/deslop-rules/*.json` (one or many rules per file).
  A legacy `~/.claude/knowledge` store still wins until `node bin/dw.js migrate` runs - write there or migrate first.
  Same engine-in-skill / data-in-store split as `dw-runbook`; the dir is created when you
  add the first rule.

## Adding a rule

1. Write it to `~/Documents/dw-agent-store/knowledge/deslop-rules/<name>.json` (single object or an array).
2. `node scripts/deslop-rules.js --list` - confirm it loads with origin `user`.
3. `node scripts/deslop-rules.js --dry-run --json` on a branch - confirm the diff is what you
   expect before writing.
4. Drop `--dry-run` to apply.

When the dev states a deterministic style preference in a session ("never X, always Y"), offer
to persist it here rather than hand-applying it every time.
