# Optional auto-recall hook

> Installed as the Claude Code **plugin**, this hook is wired automatically - the plugin's
> `hooks/hooks.json` registers it on enable, so there is nothing to configure. The manual
> snippet below remains for non-plugin installs (copied skills, Cursor-style setups).

You can wire a `UserPromptSubmit` hook so saved knowledge surfaces automatically when a
prompt matches — no need to remember to run `/dw-recall`. This is **optional** and additive.

## The two branches

`km-recall.js --hook` reads the Claude Code hook payload (`{prompt}`) from **stdin** and:

1. **Match branch** — when one or more memories match the prompt, it prints the advisory
   block to stdout (injected as context) and exits `0`.
2. **No-match branch** — when nothing matches (empty/short prompt, no term overlap, no
   memories), it prints **nothing** and exits `0`. The hook is silent and never spams.

Either way the exit code is `0`, so the hook never blocks a prompt.

## Settings snippet (APPEND — do not clobber)

Add a `UserPromptSubmit` hook that runs the recall script in `--hook` mode. Replace
`<ABS_PATH>` with the absolute path to this skill's `scripts/` directory (e.g.
`/Users/you/.claude/skills/dw-knowledge-skill/scripts`).

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node <ABS_PATH>/km-recall.js --hook"
          }
        ]
      }
    ]
  }
}
```

> **WARNING — this must be APPENDED to any existing `UserPromptSubmit` array, not pasted
> over it.** `UserPromptSubmit` is a list; if you already have hooks there, pasting this
> object verbatim will **clobber** them. Add this entry as an additional element of the
> existing array. The safe way to apply it is the **`update-config`** skill, which merges
> into `settings.json` additively instead of overwriting — prefer that over hand-editing.

## Notes

- The command must use the **absolute** path to `km-recall.js`; hooks don't inherit the
  skill's working directory.
- The script is dependency-free (`node:` builtins only) and offline — safe to run on every
  prompt. It is pure-read and never writes.
- To disable, remove just the appended array element (or have `update-config` remove it).
