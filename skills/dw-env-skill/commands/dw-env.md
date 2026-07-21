---
name: dw-env
description: Preflight the local environment, bootstrap a machine, or clone a repo into the flat layout.
---

# /dw-env

Check (and fix) local-environment readiness: the flat `{workspace}/{repo}` layout, the Docker
daemon, and the AWS credentials file - before any env-touching work.

## Invocation

`/dw-env [preflight|bootstrap|clone <repo>]`

Default subcommand is `preflight`.

## Flow

1. `preflight` (default) - from this skill directory, run:

   ```bash
   node scripts/env-preflight.js [--workspace-root <p>] [--repo <name>] [--skip layout|docker|aws]
   ```

   Add `--json` to get only the machine-readable envelope. Report the result; on `fail`, relay
   each check's `remediation` line and stop - no env-touching work on a failing preflight.
2. `bootstrap` - run the preflight first, then walk `references/bootstrap.md` in order,
   re-running the preflight after each step until it prints `"status":"pass"`.
3. `clone <repo>` - recall dw-knowledge for the concrete workspace root, clone flat to
   `{root}/{repo}` (never an org/namespace subdir), then verify with
   `node scripts/env-preflight.js --repo <repo>`.

## Hard rules

- Flat `{workspace}/{repo}` only - clone one level under the workspace root.
- Report credential presence and shape only - values stay with the dev.
- The envelope's `"status":"pass"` is the completion gate for every subcommand.
