[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$runsRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $runsRoot '..'))
$corpusRoot = [System.IO.Path]::GetFullPath((Join-Path $runsRoot 'core-corpus'))
$scopePath = Join-Path $runsRoot 'core-corpus.scope.json'

if (-not (Test-Path -LiteralPath $scopePath)) {
    throw "Missing scope file: $scopePath"
}

$scope = Get-Content -LiteralPath $scopePath -Raw | ConvertFrom-Json
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
$corpusPrefix = $corpusRoot.TrimEnd('\') + '\'

function Assert-UnderRoot {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $RootPrefix,
        [Parameter(Mandatory)] [string] $Label
    )

    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes its allowed root: $resolved"
    }
    return $resolved
}

$defaultExcludedSegments = @(
    '.agent', '.agents', '.git', '.github', '.next', '.turbo',
    'build', 'coverage', 'dist', 'graphify-out', 'logs', 'node_modules',
    'out', 'playwright-report', 'storybook-static', 'test-results'
)
$excludedSegments = @($defaultExcludedSegments + @($scope.exclude_segments)) |
    ForEach-Object { [string]$_ } |
    Where-Object { $_ } |
    Sort-Object -Unique

function Test-ExcludedRelativePath {
    param([Parameter(Mandatory)] [string] $RelativePath)

    $segments = $RelativePath -split '[\\/]'
    foreach ($segment in $segments) {
        if ($excludedSegments -contains $segment) {
            return $true
        }
    }

    $leaf = [System.IO.Path]::GetFileName($RelativePath)
    return $leaf -match '^\.env(?:\.|$)'
}

New-Item -ItemType Directory -Force -Path $corpusRoot | Out-Null
$copied = 0

foreach ($relativeDirectory in @($scope.directories)) {
    $relativeDirectory = [string]$relativeDirectory
    $sourceDirectory = Assert-UnderRoot -Path (Join-Path $repoRoot $relativeDirectory) -RootPrefix $repoPrefix -Label 'Source directory'
    $targetDirectory = Assert-UnderRoot -Path (Join-Path $corpusRoot $relativeDirectory) -RootPrefix $corpusPrefix -Label 'Target directory'

    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
        throw "Source directory does not exist: $sourceDirectory"
    }

    if (Test-Path -LiteralPath $targetDirectory) {
        Remove-Item -LiteralPath $targetDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null

    Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File -Force | ForEach-Object {
        $relativeFile = [System.IO.Path]::GetRelativePath($sourceDirectory, $_.FullName)
        if (Test-ExcludedRelativePath -RelativePath $relativeFile) {
            return
        }

        $destination = Assert-UnderRoot -Path (Join-Path $targetDirectory $relativeFile) -RootPrefix $corpusPrefix -Label 'Target file'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
        $script:copied++
    }
}

foreach ($relativeFile in @($scope.files)) {
    $relativeFile = [string]$relativeFile
    if (Test-ExcludedRelativePath -RelativePath $relativeFile) {
        throw "Explicit file is excluded by policy: $relativeFile"
    }

    $sourceFile = Assert-UnderRoot -Path (Join-Path $repoRoot $relativeFile) -RootPrefix $repoPrefix -Label 'Source file'
    $targetFile = Assert-UnderRoot -Path (Join-Path $corpusRoot $relativeFile) -RootPrefix $corpusPrefix -Label 'Target file'

    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Source file does not exist: $sourceFile"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    $copied++
}

Write-Output "Synced $copied files into $corpusRoot"

