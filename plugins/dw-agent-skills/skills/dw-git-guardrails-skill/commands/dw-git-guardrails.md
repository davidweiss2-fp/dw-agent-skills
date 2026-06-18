---
name: dw-git-guardrails
description: Install or verify the PreToolUse hook that blocks irreversible git commands.
---

# /dw-git-guardrails

Set up (or sanity-check) the guardrail hook that blocks destructive git commands — force-push,
`reset --hard`, `clean -f`, `branch -D`, `checkout .`/`restore .`, remote ref deletion — before
Claude Code runs them. The hook is a pure stdin-JSON parser: it decides allow/block and **never
executes the command**.

## Invocation

`/dw-git-guardrails [project|global] [verify]`

| Token | Meaning |
|---|---|
| `project` | Install for this repo only (`.claude/settings.json`) |
| `global` | Install for all projects (`~/.claude/settings.json`) |
| `verify` / nothing matching above | Just run the self-test, do not change settings |

## Flow

1. **Self-test first.** From this skill directory, run the parser's self-check (no repo touched):

   ```bash
   node scripts/dw-git-guardrails.js --self-test
   ```

   If `verify` was requested (or no scope given), report the result and stop here.
2. **Pick scope.** If the user named `project`/`global`, use it; otherwise ask which scope they want.
3. **Wire the hook additively.** Open `references/settings-snippet.md`, take the snippet for the
   chosen scope, and **append** it to the existing `hooks.PreToolUse` array — never overwrite. Fill
   `<ABS_PATH>` with the absolute path to this skill's `scripts/` dir. Prefer the **`update-config`**
   skill to merge it in rather than hand-editing JSON.
4. **Confirm live.** Pipe a sample through the installed path:

   ```bash
   echo '{"tool_input":{"command":"git push --force origin main"}}' | node <ABS_PATH>/dw-git-guardrails.js
   ```

   Expect a `BLOCKED ...` line on stderr and exit code `2`. A benign command (`git status`) should
   produce no output and exit `0`.
5. **Offer customization.** Point the user at the `RULES` table in
   `scripts/dw-git-guardrails.js` if they want to loosen/tighten coverage, and remind them to re-run
   `--self-test` after editing.

## Hard rules

- The hook only parses and decides — it must never run the command.
- Settings are appended, never clobbered (`PreToolUse` is a shared array).
- Fail open: a malformed payload or parse error allows the command rather than crashing the agent.
