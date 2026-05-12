[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Get-RequiredGitValue {
  param([string[]]$Arguments)

  $output = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) {
    throw "git $($Arguments -join ' ') failed."
  }

  return ($output | Select-Object -First 1)
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "Git was not found in PATH."
  exit 1
}

try {
  $repoRoot = Get-RequiredGitValue @("rev-parse", "--show-toplevel")
} catch {
  Write-Error "This script must be run inside a Git repository."
  exit 1
}

$hooksDir = Join-Path -Path $repoRoot -ChildPath ".githooks"
New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null

Push-Location $repoRoot
try {
  & git config core.hooksPath .githooks
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure core.hooksPath."
  }
} finally {
  Pop-Location
}

Write-Host "Git hooks installed for this repository."
Write-Host "core.hooksPath is set to .githooks"
Write-Host "Project memory sync will be checked after git pull and checkout."
