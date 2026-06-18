---
name: dw-git-guardrails-skill
description: >-
  Install a Claude Code PreToolUse hook that blocks irreversible git commands
  (force-push, reset --hard, clean -fd, branch -D, checkout/restore over the
  working tree, etc.) before the agent runs them. Use when the user wants a git
  safety net, asks to stop the agent from force-pushing or hard-resetting, wants
  to guard a repo against destructive git operations, or invokes
  /dw-git-guardrails. Ships a node:-only stdin-JSON hook and an additive
  settings.json snippet — the hook only decides allow/block, it never runs the
  command.
---

# Git Guardrails

Install a **PreToolUse hook** that inspects every Bash command Claude Code is about to run and
**blocks the irreversible git ones** before they execute. The hook is a pure parser: it reads the
proposed command from the hook payload on **stdin**, decides allow or block, and exits. It **never
runs git itself** — blocking is exit code `2`, allowing is exit code `0`.

## What gets blocked

Destructive, hard-to-undo operations:

- **History / remote rewrites** — `git push --force`, `push -f`, `push --force-with-lease`, and any
  `push` to a protected ref pattern you configure.
- **Working-tree / index wipes** — `git reset --hard`, `git clean -f` / `-fd` / `-fdx`.
- **Branch deletion** — `git branch -D` (force delete), `git branch -d`.
- **Discarding edits** — `git checkout .` / `git checkout -- .`, `git restore .`,
  `git restore --staged --worktree .`.
- **Tag / ref deletion to a remote** — `git push --delete`, `git push :ref`.

Everything else passes through untouched. When a command is blocked, the agent receives a short
denial on stderr explaining the operation was withheld by the user's guardrails and to ask the
human before retrying.

## How the hook decides (parser, not executor)

`scripts/dw-git-guardrails.js` reads the JSON hook payload from stdin, pulls `tool_input.command`,
then **parses** it — it does not shell out:

1. Split the command line on shell chain/pipe separators (`&&`, `||`, `;`, `|`, newlines) so a
   buried `... && git push --force` is still caught.
2. Tokenize each segment (whitespace + simple quote handling) and find `git` invocations,
   skipping leading env-var assignments and `git`'s global `-C <dir>` / `-c k=v` options to reach
   the real subcommand.
3. Match the subcommand + flags against the rule table. Flags are detected by token, so
   `--hard` is found whether written as `git reset --hard` or `git reset HEAD~1 --hard`, and
   short-flag bundles like `-fd` are decomposed.
4. First matching rule wins → print the reason to stderr, exit `2` (block). No match → exit `0`.

This is deliberately stricter and less grep-y than a substring scan: it keys off the actual git
subcommand and flag tokens, which avoids false positives like blocking `git log --oneline` just
because the word "push" appears in a commit message argument.

## Install

### 1. Pick a scope

Ask the user: guard **this repo only** or **every project**?

- **Project** — settings live in `.claude/settings.json`; reference the script by absolute path or
  via `$CLAUDE_PROJECT_DIR`.
- **Global** — settings live in `~/.claude/settings.json`; reference the script by absolute path.

The script itself is portable; only the path in settings differs.

### 2. Wire the hook (APPEND — do not clobber)

Add a `PreToolUse` matcher for the `Bash` tool that pipes the payload into the hook. The exact,
ready-to-paste snippet for both scopes — plus the merge warning — is in
[references/settings-snippet.md](references/settings-snippet.md). **`PreToolUse` is an array; the
snippet must be appended to any existing hooks, never pasted over them.** Prefer the
**`update-config`** skill to merge it in additively rather than hand-editing JSON.

### 3. Verify

From this skill directory, run the bundled self-check (it feeds sample payloads through the hook
and asserts the exit codes — it never touches a real repo):

```bash
node scripts/dw-git-guardrails.js --self-test
```

Or check one command by hand (note: this only *parses*, nothing runs):

```bash
echo '{"tool_input":{"command":"git push --force origin main"}}' | node scripts/dw-git-guardrails.js
# → prints BLOCKED ... on stderr, exits 2

echo '{"tool_input":{"command":"git status"}}' | node scripts/dw-git-guardrails.js
# → no output, exits 0
```

## Invocation

`/dw-git-guardrails [project|global] [verify]` — walk the user through install for the chosen scope,
or just run the self-test. See `commands/dw-git-guardrails.md`.

## Customizing the rules

The blocked operations live in one `RULES` table near the top of `scripts/dw-git-guardrails.js`,
each entry a `{subcommand, when, reason}` triple. To loosen or tighten coverage, add or remove
entries — e.g. drop the `branch -d` rule if you delete merged branches often, or add a rule that
blocks `push` to any ref matching `main`/`master`/`release/*`. Re-run `--self-test` after editing.

## Hard rules

- **The hook never executes the command** — it only reads stdin, parses, and returns allow/block.
  Treat any change that makes it shell out as a bug.
- **Fail open, not closed** — on malformed/empty payload or a parse error, exit `0` (allow). A hook
  that crashes the agent on every command is worse than one that occasionally misses; real safety
  comes from the explicit rules, not from blanket failure.
- **Append, never overwrite settings** — `hooks.PreToolUse` is a list shared with other hooks.
- **No secrets / no real repo data** — the hook reads only the proposed command string and decides;
  it logs nothing and stores nothing.

---

Adapted from mattpocock/skills (skills/misc/git-guardrails-claude-code), MIT. Re-expressed for this
repo as a node:-only stdin-JSON parser with chain-aware tokenized matching.
