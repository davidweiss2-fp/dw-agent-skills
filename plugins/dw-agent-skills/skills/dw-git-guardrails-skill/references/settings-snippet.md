# PreToolUse settings snippet (APPEND — do not clobber)

This wires the guardrail hook so Claude Code pipes every **Bash** command into
`dw-git-guardrails.js` *before* running it. The hook returns allow (`exit 0`) or block (`exit 2`);
it never runs the command itself.

Replace `<ABS_PATH>` with the absolute path to this skill's `scripts/` directory (e.g.
`/Users/you/.claude/skills/dw-git-guardrails-skill/scripts`). Hooks do **not** inherit the skill's
working directory, so the path must be absolute (or `$CLAUDE_PROJECT_DIR`-relative for project scope).

## Project scope — `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/skills/dw-git-guardrails-skill/scripts/dw-git-guardrails.js"
          }
        ]
      }
    ]
  }
}
```

## Global scope — `~/.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node <ABS_PATH>/dw-git-guardrails.js"
          }
        ]
      }
    ]
  }
}
```

> **WARNING — APPEND, do not clobber.** `hooks.PreToolUse` is an **array** shared with any other
> PreToolUse hooks you already run. Pasting these objects over an existing config will **delete**
> those other hooks. Add this `{matcher, hooks}` object as one more element of the existing
> `PreToolUse` array (and merge into the existing `Bash` matcher if you already have one). The safe
> way to apply it is the **`update-config`** skill, which merges into `settings.json` additively
> instead of overwriting — prefer that over hand-editing JSON.

## Notes

- The `command` must point at the **absolute** path of `dw-git-guardrails.js`.
- The hook is `node:`-builtins only, offline, and pure-read of the command string — safe to run on
  every Bash call. It logs nothing and writes nothing.
- A blocked command produces a stderr message and exit `2`; the agent sees the denial and should
  ask the human rather than work around it.
- To disable, remove just the appended array element (or have `update-config` remove it).
- After installing, verify with `node <ABS_PATH>/dw-git-guardrails.js --self-test`.
