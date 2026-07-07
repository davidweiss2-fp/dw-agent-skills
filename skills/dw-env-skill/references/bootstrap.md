# Bootstrap: new machine / new repo

Ordered flow. Re-run the preflight between steps to see what is still missing; the bootstrap
is **done when the full preflight passes**:

```bash
node scripts/env-preflight.js        # from the dw-env-skill directory
```

## 1. Tools check

Confirm the base tools exist before anything else:

```bash
command -v git node docker aws
```

Node must satisfy the repo's `engines` (>= 18). Install whatever is missing via the platform's
package manager (e.g. Homebrew on macOS).

## 2. Workspace root

- Recall the concrete root from **dw-knowledge**; if this machine has none yet, pick one with
  the user and capture it to dw-knowledge.
- Create it and make it discoverable for the preflight:

```bash
mkdir -p <WORKSPACE_ROOT>
export DW_ENV_WORKSPACE_ROOT=<WORKSPACE_ROOT>   # or pass --workspace-root each run
```

## 3. Clone layout

Every repo goes **flat**, one level under the root - never an org/namespace subdir:

```bash
git clone <REPO_URL> <WORKSPACE_ROOT>/<REPO_NAME>
```

Verify with `node scripts/env-preflight.js --repo <REPO_NAME>`.

## 4. Docker

Install Docker Desktop (or colima + the docker CLI) and start the daemon. The preflight's
`docker` check tells you whether the problem is not-installed or daemon-down.

## 5. AWS credentials - populated BY THE DEV

The dev fills `~/.aws/credentials` **themselves** (`aws configure`, or an editor). Credential
values are never pasted to an agent and never appear in a session transcript; the agent only
ever sees presence/shape via the preflight. The file must end up with at least one profile of
this shape (placeholders only):

```ini
[default]
aws_access_key_id = <YOUR_ACCESS_KEY_ID>
aws_secret_access_key = <YOUR_SECRET_ACCESS_KEY>
```

## 6. Seed / restore via runbooks

DB seeds, dump restores, and container rebuilds are recurring flows: recall dw-knowledge for an
existing method or runbook and run that. First time on a machine with no runbook yet, do it by
hand, then capture the method (dw-knowledge) and promote it on recurrence (dw-runbook).

## 7. Final gate

`node scripts/env-preflight.js` prints `"status":"pass"` - the machine is ready.
