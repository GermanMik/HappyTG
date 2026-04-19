import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveExecutable } from "../../shared/src/index.js";

import { runCommand } from "./install/commands.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function batchQuote(value: string): string {
  return value.replace(/"/g, "\"\"");
}

async function writeShellExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  await chmod(filePath, 0o755);
}

async function writeWindowsCommand(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, source.trim().replace(/\n/g, "\r\n"), "utf8");
}

async function resolvePowerShell(): Promise<string | undefined> {
  return resolveExecutable("powershell", {
    cwd: REPO_ROOT,
    env: process.env,
    platform: "win32"
  });
}

async function resolveBash(): Promise<string | undefined> {
  return resolveExecutable("bash", {
    cwd: REPO_ROOT,
    env: process.env,
    platform: "win32"
  });
}

function isWslBashLauncher(bashPath: string): boolean {
  return bashPath.replace(/\//g, "\\").toLowerCase().endsWith("\\windows\\system32\\bash.exe");
}

function toBashPath(filePath: string, bashPath: string): string {
  if (!isWslBashLauncher(bashPath)) {
    return filePath.replace(/\\/g, "/");
  }

  if (/^[A-Za-z]:\\/u.test(filePath)) {
    return `/mnt/${filePath[0]!.toLowerCase()}${filePath.slice(2).replace(/\\/g, "/")}`;
  }

  return filePath.replace(/\\/g, "/");
}

function quoteBash(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function makeWindowsBootstrapHarness(tempDir: string, preloadPath: string): Promise<{
  binDir: string;
  bootstrapDir: string;
  logPath: string;
}> {
  const binDir = path.join(tempDir, "bin");
  const bootstrapDir = path.join(tempDir, "bootstrap-repo");
  const logPath = path.join(tempDir, "calls.log");
  const escapedPreloadPath = preloadPath.replace(/\\/g, "\\");
  await mkdir(path.join(bootstrapDir, ".git"), { recursive: true });
  await mkdir(binDir, { recursive: true });

  await Promise.all([
    writeWindowsCommand(
      path.join(binDir, "node.cmd"),
      `
        @echo off
        setlocal
        >>"${batchQuote(logPath)}" echo NODE %*
        >>"${batchQuote(logPath)}" echo NODE_OPTIONS=%NODE_OPTIONS%
        if not "%NODE_OPTIONS%"=="" (
          if /I not "%NODE_OPTIONS%"=="%NODE_OPTIONS:${escapedPreloadPath}=%" (
            >&2 echo node:internal/modules/cjs/loader:1479
            >&2 echo   throw err;
            >&2 echo   ^
            >&2 echo.
            >&2 echo Error: Cannot find module '${preloadPath}'
            >&2 echo Require stack:
            >&2 echo - internal/preload
            >&2 echo.
            >&2 echo Node.js v24.15.0
            exit /b 1
          )
        )
        if "%1"=="-p" (
          echo 24.15.0
          exit /b 0
        )
        if "%1"=="--version" (
          echo v24.15.0
          exit /b 0
        )
        echo unexpected-node %*>>"${batchQuote(logPath)}"
        exit /b 0
      `
    ),
    writeWindowsCommand(
      path.join(binDir, "git.cmd"),
      `
        @echo off
        >>"${batchQuote(logPath)}" echo GIT %*
        exit /b 0
      `
    ),
    writeWindowsCommand(
      path.join(binDir, "pnpm.cmd"),
      `
        @echo off
        >>"${batchQuote(logPath)}" echo PNPM %*
        >>"${batchQuote(logPath)}" echo PNPM_NODE_OPTIONS=%NODE_OPTIONS%
        if "%1"=="help" (
          if "%2"=="approve-builds" (
            echo Version 10.0.0
            echo No results for "approve-builds"
            exit /b 0
          )
        )
        if "%1"=="dlx" (
          if "%2"=="tsx" (
            if "%3"=="--eval" (
              echo HTG_INSTALLER_BOOTSTRAP_OK:1
              exit /b 0
            )
          )
        )
        echo fake pnpm handoff ok
        exit /b 0
      `
    ),
    writeWindowsCommand(
      path.join(binDir, "winget.cmd"),
      `
        @echo off
        >>"${batchQuote(logPath)}" echo WINGET %*
        echo fake winget should not be needed
        exit /b 0
      `
    )
  ]);

  return {
    binDir,
    bootstrapDir,
    logPath
  };
}

test("install.ps1 clears only broken external NODE_OPTIONS preload and does not misdiagnose Node as missing", async () => {
  const powershellPath = await resolvePowerShell();
  if (!powershellPath) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-ps1-external-preload-"));
  const externalDir = path.join(tempDir, "external");
  await mkdir(externalDir, { recursive: true });
  const preloadPath = path.join(externalDir, "missing-preload.cjs");

  try {
    const { binDir, bootstrapDir, logPath } = await makeWindowsBootstrapHarness(tempDir, preloadPath);
    const result = await runCommand({
      command: powershellPath,
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(REPO_ROOT, "scripts", "install", "install.ps1"),
        "--json",
        "--non-interactive",
        "--repo-mode",
        "current",
        "--repo-dir",
        ".",
        "--background",
        "skip",
        "--post-check",
        "setup"
      ],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: binDir,
        Path: binDir,
        PATHEXT: ".CMD;.EXE",
        HOME: tempDir,
        USERPROFILE: tempDir,
        APPDATA: tempDir,
        HAPPYTG_BOOTSTRAP_DIR: bootstrapDir,
        HAPPYTG_REPO_URL: "https://example.invalid/HappyTG.git",
        NODE_OPTIONS: `--require ${preloadPath}`
      },
      platform: "win32"
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    const log = await readFile(logPath, "utf8");

    assert.equal(result.exitCode, 0);
    assert.match(combined, /Ignoring broken external NODE_OPTIONS preload/i);
    assert.match(combined, /fake pnpm handoff ok/i);
    assert.doesNotMatch(combined, /Node\.js 22\+ is still not available on PATH/i);
    assert.doesNotMatch(combined, /Installing Node\.js LTS with winget/i);
    assert.doesNotMatch(log, /^WINGET /m);
    assert.match(log, /^PNPM_NODE_OPTIONS=$/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("install.ps1 keeps missing preload failures inside HAPPYTG_BOOTSTRAP_DIR as a hard error", async () => {
  const powershellPath = await resolvePowerShell();
  if (!powershellPath) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-ps1-bootstrap-preload-"));
  try {
    const preloadPath = path.join(tempDir, "bootstrap-repo", "missing-preload.cjs");
    const { binDir, bootstrapDir, logPath } = await makeWindowsBootstrapHarness(tempDir, preloadPath);
    const result = await runCommand({
      command: powershellPath,
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(REPO_ROOT, "scripts", "install", "install.ps1"),
        "--json",
        "--non-interactive",
        "--repo-mode",
        "current",
        "--repo-dir",
        ".",
        "--background",
        "skip",
        "--post-check",
        "setup"
      ],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: binDir,
        Path: binDir,
        PATHEXT: ".CMD;.EXE",
        HOME: tempDir,
        USERPROFILE: tempDir,
        APPDATA: tempDir,
        HAPPYTG_BOOTSTRAP_DIR: bootstrapDir,
        HAPPYTG_REPO_URL: "https://example.invalid/HappyTG.git",
        NODE_OPTIONS: `--require ${preloadPath}`
      },
      platform: "win32"
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    const log = await readFile(logPath, "utf8");

    assert.equal(result.exitCode, 1);
    assert.match(combined, /missing preload inside HAP[\s\S]*PYTG_BOOTSTRAP_DIR/i);
    assert.doesNotMatch(combined, /Ignoring broken external NODE_OPTIONS preload/i);
    assert.doesNotMatch(log, /^WINGET /m);
    assert.doesNotMatch(log, /^PNPM /m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("install.ps1 normalizes ignored build script bootstrap warnings before handing off to the shared installer", async () => {
  const powershellPath = await resolvePowerShell();
  if (!powershellPath) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-ps1-build-script-warning-"));
  const externalDir = path.join(tempDir, "external");
  await mkdir(externalDir, { recursive: true });
  const preloadPath = path.join(externalDir, "missing-preload.cjs");

  try {
    const { binDir, bootstrapDir, logPath } = await makeWindowsBootstrapHarness(tempDir, preloadPath);
    await writeWindowsCommand(
      path.join(binDir, "pnpm.cmd"),
      `
        @echo off
        >>"${batchQuote(logPath)}" echo PNPM %*
        >>"${batchQuote(logPath)}" echo PNPM_NODE_OPTIONS=%NODE_OPTIONS%
        if "%1"=="help" (
          if "%2"=="approve-builds" (
            echo Version 10.0.0
            echo No results for "approve-builds"
            exit /b 0
          )
        )
        if "%1"=="dlx" (
          if "%2"=="tsx" (
            if "%3"=="--eval" (
              echo Warning:
              echo Ignored build scripts: esbuild@0.27.7.
              echo Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
              echo HTG_INSTALLER_BOOTSTRAP_OK:1
              exit /b 0
            )
          )
        )
        echo fake pnpm handoff ok
        exit /b 0
      `
    );

    const result = await runCommand({
      command: powershellPath,
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(REPO_ROOT, "scripts", "install", "install.ps1"),
        "--json",
        "--non-interactive",
        "--repo-mode",
        "current",
        "--repo-dir",
        ".",
        "--background",
        "skip",
        "--post-check",
        "setup"
      ],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: binDir,
        Path: binDir,
        PATHEXT: ".CMD;.EXE",
        HOME: tempDir,
        USERPROFILE: tempDir,
        APPDATA: tempDir,
        HAPPYTG_BOOTSTRAP_DIR: bootstrapDir,
        HAPPYTG_REPO_URL: "https://example.invalid/HappyTG.git"
      },
      platform: "win32"
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    const log = await readFile(logPath, "utf8");

    assert.equal(result.exitCode, 0);
    assert.match(combined, /pnpm ignored build scripts while preparing the shared installer bootstrap/i);
    assert.match(combined, /does not support pnpm approve-builds/i);
    assert.doesNotMatch(combined, /Ignored build scripts: esbuild@0\.27\.7\./i);
    assert.match(combined, /fake pnpm handoff ok/i);
    assert.match(log, /^PNPM dlx tsx --eval/m);
    assert.match(log, /^PNPM --silent dlx tsx packages\/bootstrap\/src\/cli\.ts install/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("install.sh mirrors the external NODE_OPTIONS preload sanitization without a false Node-missing diagnosis", async () => {
  const bashPath = await resolveBash();
  if (!bashPath) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-sh-external-preload-"));
  const binDir = path.join(tempDir, "bin");
  const bootstrapDir = path.join(tempDir, "bootstrap-repo");
  const externalDir = path.join(tempDir, "external");
  const logPath = path.join(tempDir, "calls.log");
  const tempScript = path.join(tempDir, "install-lf.sh");
  const posixBinDir = toBashPath(binDir, bashPath);
  const posixBootstrapDir = toBashPath(bootstrapDir, bashPath);
  const posixHomeDir = toBashPath(tempDir, bashPath);
  const posixLogPath = toBashPath(logPath, bashPath);
  const posixTempScript = toBashPath(tempScript, bashPath);
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(path.join(bootstrapDir, ".git"), { recursive: true }),
    mkdir(externalDir, { recursive: true })
  ]);
  const preloadPath = path.join(externalDir, "missing-preload.cjs");
  const posixPreloadPath = toBashPath(preloadPath, bashPath);

  try {
    await writeFile(logPath, "", "utf8");
    await Promise.all([
      writeShellExecutable(
        path.join(binDir, "node"),
        `
          #!/bin/sh
          printf 'NODE %s\\n' "$*" >> "${posixLogPath}"
          printf 'NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" >> "${posixLogPath}"
          if [ -n "\${NODE_OPTIONS:-}" ] && printf '%s' "\${NODE_OPTIONS}" | grep -F -- "${posixPreloadPath}" >/dev/null; then
            printf '%s\\n' "node:internal/modules/cjs/loader:1479" >&2
            printf '%s\\n' "  throw err;" >&2
            printf '%s\\n' "" >&2
            printf '%s\\n' "Error: Cannot find module '${posixPreloadPath}'" >&2
            printf '%s\\n' "Require stack:" >&2
            printf '%s\\n' "- internal/preload" >&2
            printf '%s\\n' "" >&2
            printf '%s\\n' "Node.js v24.15.0" >&2
            exit 1
          fi
          if [ "$1" = "-p" ]; then
            printf '%s\\n' "24.15.0"
            exit 0
          fi
          if [ "$1" = "--version" ]; then
            printf '%s\\n' "v24.15.0"
            exit 0
          fi
          exit 0
        `
      ),
      writeShellExecutable(
        path.join(binDir, "git"),
        `
          #!/bin/sh
          printf 'GIT %s\\n' "$*" >> "${posixLogPath}"
          exit 0
        `
      ),
      writeShellExecutable(
        path.join(binDir, "pnpm"),
        `
          #!/bin/sh
          printf 'PNPM %s\\n' "$*" >> "${posixLogPath}"
          printf 'PNPM_NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" >> "${posixLogPath}"
          if [ "$1" = "help" ] && [ "$2" = "approve-builds" ]; then
            printf '%s\\n' "Version 10.0.0"
            printf '%s\\n' 'No results for "approve-builds"'
            exit 0
          fi
          if [ "$1" = "dlx" ] && [ "$2" = "tsx" ] && [ "$3" = "--eval" ]; then
            printf '%s\\n' "HTG_INSTALLER_BOOTSTRAP_OK:1"
            exit 0
          fi
          printf '%s\\n' "fake pnpm handoff ok"
          exit 0
        `
      ),
      writeShellExecutable(
        path.join(binDir, "uname"),
        `
          #!/bin/sh
          printf '%s\\n' "Linux"
        `
      )
    ]);

    const installSh = await readFile(path.join(REPO_ROOT, "scripts", "install", "install.sh"), "utf8");
    await writeShellExecutable(tempScript, installSh.replace(/\r\n/g, "\n"));
    const shellPaths = [
      path.join(binDir, "node"),
      path.join(binDir, "git"),
      path.join(binDir, "pnpm"),
      path.join(binDir, "uname"),
      tempScript
    ].map((filePath) => toBashPath(filePath, bashPath));
    const chmodTargets = shellPaths.map((filePath) => quoteBash(filePath)).join(" ");

    const result = await runCommand({
      command: bashPath,
      args: [
        "-lc",
        `chmod +x ${chmodTargets}; PATH=${quoteBash(posixBinDir)}:"$PATH"; export PATH; export HOME=${quoteBash(posixHomeDir)}; export HAPPYTG_BOOTSTRAP_DIR=${quoteBash(posixBootstrapDir)}; export HAPPYTG_REPO_URL='https://example.invalid/HappyTG.git'; export NODE_OPTIONS=${quoteBash(`--require ${posixPreloadPath}`)}; ${quoteBash(posixTempScript)} --json --non-interactive --repo-mode current --repo-dir . --background skip --post-check setup`
      ],
      cwd: REPO_ROOT,
      env: process.env,
      platform: "win32"
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    const log = await readFile(logPath, "utf8");

    assert.equal(result.exitCode, 0);
    assert.match(combined, /Ignoring broken external NODE_OPTIONS preload/i);
    assert.match(combined, /fake pnpm handoff ok/i);
    assert.doesNotMatch(combined, /Node\.js 22\+ is still not available on PATH/i);
    assert.doesNotMatch(combined, /Node\.js 22\+ is required to continue/i);
    assert.match(log, /^PNPM_NODE_OPTIONS=$/m);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
