#!/usr/bin/env bash
set -euo pipefail

REPO="davidweiss2-fp/dw-agent-skills"

if ! command -v node >/dev/null 2>&1; then
  echo "dw-agent-skills: Node.js (>=18) required." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "dw-agent-skills: Node $NODE_MAJOR too old. Need >=18." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd)" || here=""
if [ -n "$here" ] && [ -f "$here/bin/install.js" ]; then
  exec node "$here/bin/install.js" "$@"
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "dw-agent-skills: npx required." >&2
  exit 1
fi

exec npx -y "github:$REPO" "$@"
