# Redaction for handoff documents

A handoff summarizes real work, so it can quietly carry secrets: a token you pasted to test an
endpoint, a connection string in an error message, an internal hostname, an account ID, a teammate's
email. None of that should leave in a scratch document that gets handed to another agent.

## Reuse the shared scrubber

This skill deliberately ships **no** redaction code of its own. The `dw-knowledge-skill` already
maintains a deterministic, `node:`-only secret scrubber (`scripts/km-scrub.js`) that is the hard
write-gate for that skill. Duplicating it here would mean two copies drifting apart, and the scrubber
is dependency-free and offline — no network, no clock, no randomness — so it's safe to run on every
handoff. See `SKILL.md` (Redaction section) for the exact command and how to apply its exit code.

## What it does

- **Auto-slots** what can be safely genericized: API tokens/keys → `{api_key}`, connection strings →
  `{connection_string}`, internal/`*.internal`/`*.corp`/opt-in org hostnames → `{host}`, RFC1918 IPs
  → `{host}`, long account/tenant/org IDs → `{account_id}`, emails → `{email}`, UUIDs → `{uuid}`, and
  high-entropy blobs → `{secret}`. Placeholder hosts/emails (`example.com`, `localhost`) pass through.
- **Refuses** what it can't safely genericize — most importantly a private-key body. On refusal it
  exits `2`.

## Belt and suspenders

The scrubber is the deterministic backstop, not a license to be careless. While summarizing, prefer
referencing where a secret *lives* (env var name, secret manager path) over reproducing its value,
and link artifacts by path/URL instead of pasting their contents. The cleanest redaction is the
secret kept out of the document in the first place.
