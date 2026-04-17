$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:HAPPYTG_REPO_URL) { $env:HAPPYTG_REPO_URL } else { "https://github.com/GermanMik/HappyTG.git" }
$Branch = if ($env:HAPPYTG_INSTALL_BRANCH) { $env:HAPPYTG_INSTALL_BRANCH } else { "main" }
$OriginalCwd = (Get-Location).Path
$BootstrapDir = if ($env:HAPPYTG_BOOTSTRAP_DIR) { $env:HAPPYTG_BOOTSTRAP_DIR } else { Join-Path $HOME ".happytg\bootstrap-repo" }

function Fail([string]$Message) {
  Write-Error "HappyTG installer bootstrap failed: $Message"
  exit 1
}

function Have-Cmd([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($machine, $user) | Where-Object { $_ }
  if ($parts.Count -gt 0) {
    $env:Path = ($parts -join ";")
  }
}

function Resolve-AbsolutePath([string]$Value) {
  if (-not $Value) {
    return $null
  }

  try {
    return [System.IO.Path]::GetFullPath($Value)
  } catch {
    return $Value
  }
}

function Test-PathWithin([string]$Candidate, [string]$Root) {
  $candidatePath = Resolve-AbsolutePath $Candidate
  $rootPath = Resolve-AbsolutePath $Root
  if (-not $candidatePath -or -not $rootPath) {
    return $false
  }

  $trimmedRoot = $rootPath.TrimEnd('\', '/')
  return $candidatePath.Equals($trimmedRoot, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $candidatePath.StartsWith("$trimmedRoot\", [System.StringComparison]::OrdinalIgnoreCase) `
    -or $candidatePath.StartsWith("$trimmedRoot/", [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-NodePreloadFailure([string]$Output) {
  if (-not $Output) {
    return $null
  }

  $match = [regex]::Match(
    $Output,
    "Cannot find module '([^']+)'.*?Require stack:\s*- internal/preload",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $match.Success) {
    return $null
  }

  $missingPath = Resolve-AbsolutePath $match.Groups[1].Value
  $scope = if (Test-PathWithin $missingPath $BootstrapDir) {
    "bootstrap"
  } elseif (Test-PathWithin $missingPath $OriginalCwd) {
    "workspace"
  } else {
    "external"
  }

  return [pscustomobject]@{
    MissingPath = $missingPath
    Scope = $scope
  }
}

function Use-BootstrapSafeNodeOptions([pscustomobject]$PreloadFailure) {
  if (-not $PreloadFailure -or $PreloadFailure.Scope -ne "external" -or -not $env:NODE_OPTIONS) {
    return $false
  }

  Write-Warning "Ignoring broken external NODE_OPTIONS preload for HappyTG bootstrap: $($PreloadFailure.MissingPath). HappyTG does not manage this preload; bootstrap commands will continue with NODE_OPTIONS cleared."
  $env:HAPPYTG_BOOTSTRAP_IGNORED_NODE_OPTIONS = $env:NODE_OPTIONS
  Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  return $true
}

function Get-NodeProbe {
  if (-not (Have-Cmd "node")) {
    return [pscustomobject]@{
      Present = $false
      Version = $null
      Major = 0
      Error = $null
      PreloadFailure = $null
    }
  }

  $cmd = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
  $output = @(& $cmd /d /s /c 'node -p "process.versions.node" 2>&1')
  $exitCode = $LASTEXITCODE
  $text = ($output | Out-String).Trim()
  $preloadFailure = Get-NodePreloadFailure $text

  if ($exitCode -ne 0 -and (Use-BootstrapSafeNodeOptions $preloadFailure)) {
    return Get-NodeProbe
  }

  $version = $null
  $major = 0
  if ($exitCode -eq 0 -and $text) {
    $version = ($text -split "\r?\n")[0].Trim()
    $majorMatch = [regex]::Match($version, "^v?(\d+)")
    if ($majorMatch.Success) {
      $major = [int]$majorMatch.Groups[1].Value
    }
  }

  return [pscustomobject]@{
    Present = $true
    Version = $version
    Major = $major
    Error = if ($exitCode -eq 0) { $null } else { $text }
    PreloadFailure = $preloadFailure
  }
}

function Describe-NodeFailure([pscustomobject]$Probe) {
  if (-not $Probe.Error) {
    return "Node.js 22+ is not available in the current shell."
  }

  if ($Probe.PreloadFailure) {
    switch ($Probe.PreloadFailure.Scope) {
      "bootstrap" {
        return "Node.js is installed, but NODE_OPTIONS requires a missing preload inside HAPPYTG_BOOTSTRAP_DIR: $($Probe.PreloadFailure.MissingPath). Repair the bootstrap checkout or clear NODE_OPTIONS, then rerun the installer."
      }
      "workspace" {
        return "Node.js is installed, but NODE_OPTIONS requires a missing preload inside the selected workspace: $($Probe.PreloadFailure.MissingPath). Repair that preload or clear NODE_OPTIONS, then rerun the installer."
      }
      default {
        return "Node.js is installed, but an external NODE_OPTIONS preload is missing: $($Probe.PreloadFailure.MissingPath). Clear or repair NODE_OPTIONS, then rerun the installer."
      }
    }
  }

  return "Node.js is installed, but it could not start cleanly in this shell. Clear or repair the local Node runtime settings, then rerun the installer.`n$($Probe.Error)"
}

function Node-Major {
  return (Get-NodeProbe).Major
}

function Ensure-Git {
  if (Have-Cmd "git") {
    return
  }

  if (Have-Cmd "winget") {
    Write-Host "Installing Git with winget..."
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
    return
  }

  if (Have-Cmd "choco") {
    Write-Host "Installing Git with Chocolatey..."
    choco install git -y
    Refresh-Path
    return
  }

  Fail "Git is missing. Install Git for Windows, then rerun the installer."
}

function Ensure-Node {
  $nodeProbe = Get-NodeProbe
  if ($nodeProbe.Major -ge 22) {
    return
  }

  if ($nodeProbe.Present -and $nodeProbe.Error) {
    Fail (Describe-NodeFailure $nodeProbe)
  }

  if (Have-Cmd "winget") {
    Write-Host "Installing Node.js LTS with winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
    return
  }

  if (Have-Cmd "choco") {
    Write-Host "Installing Node.js LTS with Chocolatey..."
    choco install nodejs-lts -y
    Refresh-Path
    return
  }

  Fail "Node.js 22+ is required. Install Node.js manually, then rerun the installer."
}

function Ensure-Pnpm {
  if (Have-Cmd "pnpm") {
    return
  }

  if (Have-Cmd "corepack") {
    Write-Host "Activating pnpm with corepack..."
    corepack enable
    corepack prepare pnpm@10.0.0 --activate
    Refresh-Path
    return
  }

  if (Have-Cmd "npm") {
    Write-Host "Installing pnpm globally..."
    npm install -g pnpm
    Refresh-Path
    return
  }

  Fail "pnpm is required. Install it with npm or corepack, then rerun the installer."
}

function Sync-BootstrapRepo {
  $Parent = Split-Path -Parent $BootstrapDir
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null

  if (Test-Path (Join-Path $BootstrapDir ".git")) {
    Write-Host "Updating bootstrap checkout in $BootstrapDir..."
    git -C $BootstrapDir fetch --all --prune
    git -C $BootstrapDir checkout $Branch
    git -C $BootstrapDir pull --ff-only origin $Branch
    return
  }

  if (Test-Path $BootstrapDir) {
    Remove-Item -Recurse -Force $BootstrapDir
  }

  Write-Host "Cloning HappyTG bootstrap checkout into $BootstrapDir..."
  git clone --branch $Branch $RepoUrl $BootstrapDir
}

function Run-SharedInstaller {
  Write-Host "Handing off to the shared HappyTG installer..."
  Push-Location $BootstrapDir
  try {
    & pnpm dlx tsx packages/bootstrap/src/cli.ts install `
      --launch-cwd $OriginalCwd `
      --bootstrap-repo-root $BootstrapDir `
      --repo-url $RepoUrl `
      --branch $Branch `
      @args
  } finally {
    Pop-Location
  }
}

Ensure-Git
if (-not (Have-Cmd "git")) { Fail "Git is still not available on PATH. Open a new PowerShell session and rerun the installer." }
Ensure-Node
$nodeProbe = Get-NodeProbe
if ($nodeProbe.Major -lt 22) {
  if ($nodeProbe.Present -and $nodeProbe.Error) {
    Fail (Describe-NodeFailure $nodeProbe)
  }

  $foundVersion = if ($nodeProbe.Version) { " Found $($nodeProbe.Version)." } else { "" }
  Fail "Node.js 22+ is still not available on PATH.$foundVersion Open a new PowerShell session and rerun the installer."
}
Ensure-Pnpm
if (-not (Have-Cmd "pnpm")) { Fail "pnpm is still not available on PATH. Open a new PowerShell session and rerun the installer." }
Sync-BootstrapRepo
Run-SharedInstaller
