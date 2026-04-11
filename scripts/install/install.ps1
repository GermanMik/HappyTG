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

function Node-Major {
  if (-not (Have-Cmd "node")) {
    return 0
  }

  try {
    return [int](node -p "process.versions.node.split('.')[0]")
  } catch {
    return 0
  }
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
  if ((Node-Major) -ge 22) {
    return
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
if ((Node-Major) -lt 22) { Fail "Node.js 22+ is still not available on PATH. Open a new PowerShell session and rerun the installer." }
Ensure-Pnpm
if (-not (Have-Cmd "pnpm")) { Fail "pnpm is still not available on PATH. Open a new PowerShell session and rerun the installer." }
Sync-BootstrapRepo
Run-SharedInstaller
