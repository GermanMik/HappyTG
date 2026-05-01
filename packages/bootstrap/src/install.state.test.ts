import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readInstallState, writeInstallState } from "./install/state.js";
import { resetBackgroundModeArtifacts } from "./install/background.js";
import type { InstallResult } from "./install/types.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function installResult(input: {
  stateDir: string;
  repoRoot: string;
  background: InstallResult["background"];
}): InstallResult {
  return {
    kind: "install",
    status: "pass",
    outcome: "success",
    interactive: false,
    tuiHandled: false,
    repo: {
      mode: "current",
      path: input.repoRoot,
      sync: "reused",
      dirtyStrategy: "keep",
      source: "local",
      repoUrl: "https://github.com/GermanMik/HappyTG.git",
      attempts: 0,
      fallbackUsed: false
    },
    environment: {
      platform: {
        platform: "win32",
        arch: "x64",
        shell: "powershell.exe",
        linuxFamily: "unknown",
        systemPackageManager: "winget",
        repoPackageManager: "pnpm",
        isInteractiveTerminal: false
      },
      dependencies: []
    },
    telegram: {
      configured: true,
      allowedUserIds: ["1001"]
    },
    background: input.background,
    launch: {
      mode: "skip",
      status: "skipped",
      detail: "Launch skipped in test fixture.",
      commands: [],
      health: [],
      warnings: [],
      nextSteps: []
    },
    postChecks: [],
    steps: [],
    nextSteps: [],
    warnings: [],
    reportJson: {
      stateDir: input.stateDir
    }
  };
}

test("writeInstallState records only the current launcher ownership after install-time reset", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-state-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, ".happytg-state");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.cmd");
  const startupPath = path.join(tempDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HappyTG Host Daemon.cmd");

  try {
    await writeInstallState({
      result: installResult({
        stateDir,
        repoRoot,
        background: {
          mode: "scheduled-task",
          status: "configured",
          detail: "Scheduled Task configured.",
          launcherPath,
          ownedArtifacts: [
            {
              kind: "launcher",
              mode: "scheduled-task",
              path: launcherPath
            },
            {
              kind: "scheduled-task",
              mode: "scheduled-task",
              taskName: "HappyTG Host Daemon"
            }
          ]
        }
      }),
      env: {
        HOME: tempDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32"
    });

    await writeInstallState({
      result: installResult({
        stateDir,
        repoRoot,
        background: {
          mode: "startup",
          status: "configured",
          detail: "Startup shortcut configured.",
          artifactPath: startupPath,
          launcherPath,
          ownedArtifacts: [
            {
              kind: "launcher",
              mode: "startup",
              path: launcherPath
            },
            {
              kind: "startup-shortcut",
              mode: "startup",
              path: startupPath
            }
          ]
        }
      }),
      env: {
        HOME: tempDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32"
    });

    const persisted = await readInstallState({
      env: {
        HOME: tempDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32"
    });

    assert.equal(persisted?.background.mode, "startup");
    assert.deepEqual(
      persisted?.background.ownedArtifacts,
      [
        {
          kind: "launcher",
          mode: "startup",
          path: launcherPath
        },
        {
          kind: "startup-shortcut",
          mode: "startup",
          path: startupPath
        }
      ]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resetBackgroundModeArtifacts removes default Windows Scheduled Task and Startup shortcut before reconfigure", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-background-reset-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, ".happytg");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.cmd");
  const startupPath = path.join(tempDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HappyTG Host Daemon.cmd");
  const commands: string[] = [];

  try {
    await Promise.all([
      mkdir(repoRoot, { recursive: true }),
      mkdir(path.dirname(launcherPath), { recursive: true }),
      mkdir(path.dirname(startupPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(launcherPath, "@echo off\r\npnpm dev:daemon\r\n", "utf8"),
      writeFile(startupPath, "@echo off\r\ncall launcher\r\n", "utf8")
    ]);

    const result = await resetBackgroundModeArtifacts({
      cwd: repoRoot,
      env: {
        HOME: tempDir,
        USERPROFILE: tempDir,
        APPDATA: path.join(tempDir, "AppData", "Roaming")
      },
      platform: "win32",
      resolveExecutableImpl: async (command) => command === "schtasks" ? `C:\\Windows\\System32\\${command}.exe` : undefined,
      runCommandImpl: async ({ command, args }) => {
        commands.push([command, ...(args ?? [])].join(" "));
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: command,
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(await exists(launcherPath), false);
    assert.equal(await exists(startupPath), false);
    assert.ok(commands.some((entry) => entry.includes("/Query /TN HappyTG Host Daemon")));
    assert.ok(commands.some((entry) => entry.includes("/Delete /F /TN HappyTG Host Daemon")));
    assert.equal(result.warnings.length, 0);
    assert.ok(!result.kept.some((item) => item.includes("custom HAPPYTG_STATE_DIR")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resetBackgroundModeArtifacts keeps unowned default Windows global launchers for custom state dirs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-background-reset-custom-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, "custom-state");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.cmd");
  const startupPath = path.join(tempDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HappyTG Host Daemon.cmd");
  const commands: string[] = [];

  try {
    await Promise.all([
      mkdir(repoRoot, { recursive: true }),
      mkdir(path.dirname(launcherPath), { recursive: true }),
      mkdir(path.dirname(startupPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(launcherPath, "@echo off\r\npnpm dev:daemon\r\n", "utf8"),
      writeFile(startupPath, "@echo off\r\ncall launcher\r\n", "utf8")
    ]);

    const result = await resetBackgroundModeArtifacts({
      cwd: repoRoot,
      env: {
        HOME: tempDir,
        USERPROFILE: tempDir,
        APPDATA: path.join(tempDir, "AppData", "Roaming"),
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32",
      resolveExecutableImpl: async (command) => command === "schtasks" ? `C:\\Windows\\System32\\${command}.exe` : undefined,
      runCommandImpl: async ({ command, args }) => {
        commands.push([command, ...(args ?? [])].join(" "));
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: command,
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(await exists(launcherPath), false);
    assert.equal(await exists(startupPath), true);
    assert.deepEqual(commands, []);
    assert.ok(result.kept.some((item) => item.includes("Skipped default Scheduled Task reset")));
    assert.ok(result.kept.some((item) => item.includes("Skipped default Startup shortcut reset")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
