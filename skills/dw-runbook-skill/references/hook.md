# Optional hint hook (PreToolUse, advisory)

`scripts/dw-runbook-hint.js` nudges the agent toward a saved runbook when it's about to hand-run a
command that a runbook's `triggers` cover. It is **advisory**: it always exits 0 and only adds
context — it never blocks a command. It fails open on any parse/scan error and only reads the
command string (no shelling out).

For each runbook whose `manifest.triggers` (array of regex strings) matches the proposed Bash
command, it emits a suggestion to run `node scripts/run.js <name> --scope <scope>` instead.

Verify the matching logic any time: `node scripts/dw-runbook-hint.js --self-test`.

## Wiring — APPEND, do not clobber

`hooks.PreToolUse` is an array shared with any other PreToolUse hooks (e.g. `dw-git-guardrails`).
Add this as **one more element**; don't overwrite. Prefer the **`update-config`** skill, which
merges additively.

Replace `<ABS_PATH>` with the absolute path to this skill's `scripts/` dir.

### Project scope — `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/skills/dw-runbook-skill/scripts/dw-runbook-hint.js"
          }
        ]
      }
    ]
  }
}
```

### Global scope — `~/.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "node <ABS_PATH>/dw-runbook-hint.js"}]
      }
    ]
  }
}
```

## Notes

- To make a runbook fire the hook, give its manifest `triggers`, e.g.
  `"triggers": ["(^|\\s)npm (run )?test\\b", "phpstan"]`.
- The hook surfaces a `systemMessage` and PreToolUse `additionalContext`; it adds no latency of
  consequence (a directory scan of the two store roots) and writes nothing.
- To disable, remove just the appended array element (or have `update-config` remove it).
