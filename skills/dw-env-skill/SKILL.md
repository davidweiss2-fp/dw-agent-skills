---
name: dw-env-skill
description: >-
  Owns the canonical workspace layout and local-environment readiness - one
  flat {workspace}/{repo} level, never a namespace subdir - with a
  deterministic preflight (Docker daemon, AWS credentials file, layout) and a
  bootstrap flow for new machines and repos. Use when the user says "clone",
  "checkout a repo", "set up the env", "bootstrap", "new machine", "install
  docker", "seed the local db", or when a restore/build fails on Docker or
  empty AWS credentials.
---

# Environment: the layout invariant + a readiness preflight

This skill makes two things non-negotiable before any environment-touching work: every repo
sits **flat** under the workspace root, and the machine is **ready** (Docker up, AWS
credentials file populated). Both are checked by one deterministic script instead of being
rediscovered mid-task.

## The layout invariant

Every repo lives at exactly `{workspace}/{repo}` - one level below the workspace root, never
nested under a namespace/org subdir:

```
{workspace}/some-repo            correct - flat
{workspace}/some-org/some-repo   WRONG - namespace subdir
```

Four real sessions failed on exactly this: an agent cloned into `{workspace}/<github-org>/<repo>`,
every downstream path assumption broke, and the rest of the session burned on the fallout. The
namespace level carries no information locally - the org already lives in the git remote.

The concrete workspace root is machine-specific and personal. It lives in the **dw-knowledge
store**, never in this repo, this skill, or any script.

## Preflight

Run before ANY env-touching work - clone, bootstrap, db seed/restore, container builds:

```bash
node scripts/env-preflight.js [--json] [--workspace-root <p>] [--repo <name>] [--skip layout|docker|aws]
```

(from this skill directory). Checks run in fail-fast order **layout -> docker -> aws** and the
script prints a compact JSON envelope:

```json
{"command":"env-preflight","status":"pass","checks":[{"name":"layout","status":"pass","detail":"...","remediation":""}],"durationMs":42}
```

- **Completion criterion: the envelope says `"status":"pass"`** (exit code 0). On `fail`, apply
  each check's `remediation` line and re-run until it passes - do not start the env-touching
  work on a failing preflight.
- `layout` scans the workspace root for nested clones (`{root}/<ns>/<repo>/.git`) and near-empty
  namespace dirs shadowing a flat repo. Standard fix:
  `mv <root>/<ns>/<repo> <root>/<repo> && rmdir <root>/<ns>`.
- `docker` distinguishes not-installed from daemon-down and says which.
- `aws` checks `~/.aws/credentials` exists, is non-empty, and has at least one profile with
  `aws_access_key_id` - shape only, values are never read back or printed.

Workspace-root resolution precedence: `--workspace-root` flag > `DW_ENV_WORKSPACE_ROOT` env var >
parent dir of the current git root > unset (layout check is skipped with a remediation line).

## Clone / checkout flow

1. **Recall dw-knowledge for the concrete workspace root** - the personal path lives in the
   knowledge store, not here. If no memory exists, ask the user (or take the parent of an
   existing flat repo), then capture it.
2. Clone **directly under the root**: the target is `{workspace}/{repo}`, one level deep.
   Never accept a tool's default of an org/namespace subdir.
3. Verify: `node scripts/env-preflight.js --repo <repo>` reports the repo present at its flat
   path and `"status":"pass"`.

## Bootstrap (new machine / new repo)

Ordered flow - tools, layout, Docker, credentials, seed - in `references/bootstrap.md`.
Run the preflight first; bootstrap exists to make the preflight pass, and is done when the
full preflight passes.

## Runbook reuse

Repeatable shell flows that grow out of env work (seed the local db, restore a dump, rebuild
containers) follow the **dw-runbook lifecycle**: do it by hand once, capture the method to
dw-knowledge, promote to a runbook on recurrence. The preflight itself stays a plain script in
this skill because it must run where no git repo - and therefore no project runbook store -
exists yet (a brand-new machine).

## Hard rules

- **Never clone into a namespace subdir** - flat `{workspace}/{repo}`, always.
- **Never print credential values** - the preflight reports presence/shape only; the dev
  populates `~/.aws/credentials` directly, values never pass through an agent.
- **Preflight before bootstrap/restore work** - envelope `"status":"pass"` is the gate.
- **The concrete workspace root lives in dw-knowledge** - never hardcoded here.
