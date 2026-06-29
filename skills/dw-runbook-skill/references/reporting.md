# The result envelope & report parsing

A run prints one compact JSON envelope. Full tool output goes to a **log file** referenced by
`log` — never inlined. This is the token lever: the agent reads a line of signal, and only opens
the log when it needs detail.

## Envelope

```json
{
  "command": "test",
  "kind": "command",
  "status": "pass | fail | error",
  "exitCode": 0,
  "cached": false,
  "isolation": "shared-dir",
  "ref": "working",
  "sig": "…",
  "durationMs": 41200,
  "summary": "212 passed, 0 failed",
  "findings": ["…up to 10 parsed errors/failures…"],
  "findingsTruncated": false,
  "pristine": true,
  "log": "<abs path to full output>"
}
```

- `status`: `pass` (exit 0), `fail` (non-zero), or `error` (a `shared-dir` run that left the tree
  dirty — the pristine guarantee tripped).
- `cached`: `true` when served from the result cache or coalesced onto another run.
- `pristine`: `true`/`false` for `shared-dir`, `null` for `worktree` (not applicable).
- `findings`: up to `report.findingsMax` (default **10**) parsed lines, so a small failure set is
  actionable straight from the envelope. `findingsTruncated` is `true` when more matched.

A **flow** envelope drops `findings`/`exitCode` and carries `steps: [{command, status, summary,
cached, log}]`.

## report parser (manifest `report`)

| field | meaning | default |
|---|---|---|
| `summary` | regex; first match's group 1 (or whole match) becomes `summary` | `"ok"` on pass, else first finding or `exit <code>` |
| `summaryFlags` | RegExp flags for `summary` | `""` |
| `findings` | regex; matching output lines become `findings` | word-bounded `/(?:\berror\b\|\bfail(?:ed\|ure\|s)?\b\|✗\|✖\|\bFAIL\b)/i` (so `terror`/`failsafe` don't match) |
| `findingsFlags` | RegExp flags for `findings` | `"i"` |
| `findingsMax` | cap on inlined findings | `10` |

Empty-string `summary`/`findings` mean "use the default" (an empty regex would otherwise match
every line). A malformed regex falls back to the default rather than throwing. Regexes come from
your own manifest, not untrusted input; the parser only matches strings, never shells out.

Example — a PHPUnit-style command:

```json
"report": { "summary": "(Tests: .*?)(?:,|$)", "findings": "^(?:FAILED|ERROR|\\d+\\)) " }
```
