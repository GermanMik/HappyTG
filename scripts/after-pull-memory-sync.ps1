[CmdletBinding()]
param(
  [ValidateSet("manual", "post-merge", "post-checkout", "merge", "checkout")]
  [string]$Mode = "manual",

  [string]$OldRef = "",

  [string]$NewRef = ""
)

$ErrorActionPreference = "Stop"

$MemoryPathspecs = @(
  "AGENTS.md",
  "docs/memory",
  "graphify-out/GRAPH_REPORT.md",
  "graphify-out/graph.json"
)

function Get-GitLines {
  param([string[]]$Arguments)

  $output = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }

  return @($output | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}

function Get-GitRequiredValue {
  param([string[]]$Arguments)

  $lines = @(Get-GitLines $Arguments)
  if ($lines.Count -eq 0) {
    throw "git $($Arguments -join ' ') failed."
  }

  return [string]($lines | Select-Object -First 1)
}

function Resolve-GitDir {
  param([string]$RepoRoot)

  $gitDirRaw = Get-GitRequiredValue @("rev-parse", "--git-dir")
  if ([System.IO.Path]::IsPathRooted($gitDirRaw)) {
    return [System.IO.Path]::GetFullPath($gitDirRaw)
  }

  return [System.IO.Path]::GetFullPath((Join-Path -Path $RepoRoot -ChildPath $gitDirRaw))
}

function Resolve-Commit {
  param([string]$Ref)

  if ([string]::IsNullOrWhiteSpace($Ref)) {
    return ""
  }

  $lines = @(Get-GitLines @("rev-parse", "--verify", "$Ref^{commit}"))
  if ($lines.Count -eq 0) {
    return ""
  }

  return [string]($lines | Select-Object -First 1)
}

function Get-RangeMemoryChanges {
  param(
    [string]$OldCommit,
    [string]$NewCommit
  )

  if ([string]::IsNullOrWhiteSpace($OldCommit) -or [string]::IsNullOrWhiteSpace($NewCommit)) {
    return @()
  }

  if ($OldCommit -eq $NewCommit) {
    return @()
  }

  $arguments = @("diff", "--name-only", $OldCommit, $NewCommit, "--") + $MemoryPathspecs
  return @(Get-GitLines $arguments | Sort-Object -Unique)
}

function Get-ManualMemoryChanges {
  $unstaged = @(Get-GitLines (@("diff", "--name-only", "--") + $MemoryPathspecs))
  $staged = @(Get-GitLines (@("diff", "--cached", "--name-only", "--") + $MemoryPathspecs))
  $untracked = @(Get-GitLines (@("ls-files", "--others", "--exclude-standard", "--") + $MemoryPathspecs))

  return @($unstaged + $staged + $untracked | Sort-Object -Unique)
}

function Get-Sha256Hex {
  param([string]$Text)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $sha.Dispose()
  }
}

function Get-StateFingerprint {
  param([string]$StatePath)

  if (-not (Test-Path -LiteralPath $StatePath)) {
    return ""
  }

  try {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    if ($state.lastFingerprint) {
      return [string]$state.lastFingerprint
    }
  } catch {
    return ""
  }

  return ""
}

function Save-StateFingerprint {
  param(
    [string]$StatePath,
    [string]$Fingerprint,
    [string]$Mode,
    [string]$RepoName,
    [string]$Commit,
    [string[]]$ChangedFiles
  )

  $state = [ordered]@{
    lastFingerprint = $Fingerprint
    lastSavedAt = (Get-Date).ToString("o")
    mode = $Mode
    repo = $RepoName
    commit = $Commit
    files = $ChangedFiles
  }

  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Save-EchoVaultPointer {
  param(
    [string]$Mode,
    [string]$RepoName,
    [string]$Commit,
    [string[]]$ChangedFiles,
    [string]$StatePath
  )

  if ($Mode -eq "manual") {
    Write-Host "Manual mode: EchoVault pointer record skipped."
    return
  }

  $fingerprintSource = "$RepoName|$Commit|$Mode|$($ChangedFiles -join ',')"
  $fingerprint = Get-Sha256Hex $fingerprintSource
  $lastFingerprint = Get-StateFingerprint $StatePath

  if ($lastFingerprint -eq $fingerprint) {
    Write-Host "EchoVault pointer record already exists for this project memory update."
    return
  }

  if (-not (Get-Command memory -ErrorAction SilentlyContinue)) {
    Write-Host "memory CLI not found; EchoVault pointer record skipped."
    return
  }

  $changedList = ($ChangedFiles | ForEach-Object { "- $_" }) -join [Environment]::NewLine
  $relatedFiles = $ChangedFiles -join ","
  $details = @"
Context:
Project memory changed after $Mode in repo $RepoName at commit $Commit.

Changed files:
$changedList

Decision:
Store only this pointer record. Project memory contents remain in Git and are not copied into EchoVault.

Tradeoffs:
The hook is best-effort and deduplicates saves through .git/project-memory-sync-state.json.

Follow-up:
Read the changed files from the repository when project context is needed.
"@

  $arguments = @(
    "save",
    "--title", "$RepoName project memory updated",
    "--what", "Project memory files changed after $Mode.",
    "--why", "Project memory updates should be discoverable after Git pulls without storing raw memory contents.",
    "--impact", "Future sessions should read the changed repo files for current project context.",
    "--tags", "HappyTG,memory,project-memory,git-hooks",
    "--category", "context",
    "--related-files", $relatedFiles,
    "--source", "codex",
    "--details", $details
  )

  & memory @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "memory CLI failed; EchoVault pointer record skipped."
    return
  }

  Save-StateFingerprint -StatePath $StatePath -Fingerprint $fingerprint -Mode $Mode -RepoName $RepoName -Commit $Commit -ChangedFiles $ChangedFiles
  Write-Host "EchoVault pointer record saved."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  exit 0
}

try {
  $repoRoot = Get-GitRequiredValue @("rev-parse", "--show-toplevel")
  $gitDir = Resolve-GitDir -RepoRoot $repoRoot
} catch {
  exit 0
}

Push-Location $repoRoot
try {
  $normalizedMode = switch ($Mode) {
    "merge" { "post-merge" }
    "checkout" { "post-checkout" }
    default { $Mode }
  }

  $changedFiles = @()
  $eventCommit = Resolve-Commit "HEAD"

  switch ($normalizedMode) {
    "post-merge" {
      $oldCommit = Resolve-Commit "ORIG_HEAD"
      $newCommit = Resolve-Commit "HEAD"
      $changedFiles = @(Get-RangeMemoryChanges -OldCommit $oldCommit -NewCommit $newCommit)
      $eventCommit = $newCommit
    }
    "post-checkout" {
      $oldCommit = Resolve-Commit $OldRef
      $newCommit = Resolve-Commit $NewRef
      $changedFiles = @(Get-RangeMemoryChanges -OldCommit $oldCommit -NewCommit $newCommit)
      if ($newCommit) {
        $eventCommit = $newCommit
      }
    }
    "manual" {
      $changedFiles = @(Get-ManualMemoryChanges)
    }
  }

  if ($changedFiles.Count -eq 0) {
    exit 0
  }

  Write-Host "Project memory files changed:"
  foreach ($file in $changedFiles) {
    Write-Host "  - $file"
  }

  $repoName = Split-Path -Path $repoRoot -Leaf
  $statePath = Join-Path -Path $gitDir -ChildPath "project-memory-sync-state.json"
  Save-EchoVaultPointer -Mode $normalizedMode -RepoName $repoName -Commit $eventCommit -ChangedFiles $changedFiles -StatePath $statePath
} finally {
  Pop-Location
}
