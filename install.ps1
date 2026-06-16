#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Repo = "davidweiss2-fp/dw-agent-skills"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "dw-agent-skills: Node.js (>=18) required."
  exit 1
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) {
  Write-Error "dw-agent-skills: Node $major too old. Need >=18."
  exit 1
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $here "bin\install.js")) {
  & node (Join-Path $here "bin\install.js") @args
  exit $LASTEXITCODE
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error "dw-agent-skills: npx required."
  exit 1
}

& npx -y "github:$Repo" @args
exit $LASTEXITCODE
