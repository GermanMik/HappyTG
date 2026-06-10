param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "HappyTG Codex Desktop Proxy",
  [string]$ProxyHost = "127.0.0.1",
  [int]$ProxyPort = 4318,
  [string]$ProxyToken = $env:HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN,
  [switch]$Force,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

function Test-LoopbackHost {
  param([string]$HostName)
  $normalized = $HostName.Trim().Trim([char[]]"[]").ToLowerInvariant()
  return $normalized -eq "localhost" -or $normalized -eq "127.0.0.1" -or $normalized -eq "::1"
}

if (-not (Test-Path -LiteralPath $RepoDir)) {
  throw "RepoDir does not exist: $RepoDir"
}

if (-not (Test-LoopbackHost $ProxyHost) -and [string]::IsNullOrWhiteSpace($ProxyToken)) {
  throw "ProxyToken is required when ProxyHost is not loopback."
}

$stateDir = if ($env:HAPPYTG_STATE_DIR) { $env:HAPPYTG_STATE_DIR } else { Join-Path $env:USERPROFILE ".happytg" }
$binDir = Join-Path $stateDir "bin"
$logDir = Join-Path $stateDir "logs"
$launcherPath = Join-Path $binDir "happytg-codex-desktop-proxy.cmd"
$logPath = Join-Path $logDir "codex-desktop-proxy.log"

New-Item -ItemType Directory -Force -Path $binDir, $logDir | Out-Null

$tokenLine = if ([string]::IsNullOrWhiteSpace($ProxyToken)) {
  "set HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN="
} else {
  "set `"HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN=$ProxyToken`""
}

@"
@echo off
setlocal
cd /d "$RepoDir"
set "HAPPYTG_CODEX_DESKTOP_PROXY_HOST=$ProxyHost"
set "HAPPYTG_CODEX_DESKTOP_PROXY_PORT=$ProxyPort"
$tokenLine
pnpm daemon:desktop-proxy >> "$logPath" 2>&1
"@ | Set-Content -LiteralPath $launcherPath -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $launcherPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "HappyTG host-side Codex Desktop control proxy." `
  -Force:$Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Registered Scheduled Task: $TaskName"
Write-Host "Launcher: $launcherPath"
Write-Host "Log: $logPath"
