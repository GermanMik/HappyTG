import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeInstallState } from "./install/state.js";
import type { InstallResult } from "./install/types.js";
import { runHappyTGUninstall } from "./uninstall/index.js";

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function commandResult(command: string) {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    binaryPath: command,
    shell: false,
    fallbackUsed: false
  };
}

function installResult(input: {
  repoRoot: string;
  background: InstallResult["background"];
  platform: NodeJS.Platform;
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
        platform: input.platform,
        arch: "x64",
        shell: input.platform === "win32" ? "powershell.exe" : "/bin/sh",
        linuxFamily: input.platform === "linux" ? "debian" : "unknown",
        systemPackageManager: input.platform === "linux" ? "apt-get" : input.platform === "win32" ? "winget" : "brew",
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
    reportJson: {}
  };
}

test("runHappyTGUninstall removes Linux user-service, state, and bootstrap artifacts while keeping the repo checkout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-uninstall-linux-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, ".happytg-state");
  const homeDir = tempDir.replace(/\\/g, "/");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.sh");
  const bootstrapRepoPath = path.join(stateDir, "bootstrap-repo");
  const unitPath = `${homeDir}/.config/systemd/user/happytg-host-daemon.service`;
  const commands: string[] = [];

  try {
    await Promise.all([
      mkdir(repoRoot, { recursive: true }),
      mkdir(path.join(stateDir, "state"), { recursive: true }),
      mkdir(path.join(stateDir, "logs"), { recursive: true }),
      mkdir(path.join(stateDir, "backups"), { recursive: true }),
      mkdir(path.join(stateDir, "bin"), { recursive: true }),
      mkdir(path.join(bootstrapRepoPath, ".git"), { recursive: true }),
      mkdir(path.dirname(unitPath), { recursive: true })
    ]);

    await Promise.all([
      writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8"),
      writeFile(path.join(repoRoot, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(path.join(repoRoot, "README.md"), "keep me\n", "utf8"),
      writeFile(path.join(stateDir, "daemon-state.json"), "{\"hostId\":\"host_1\"}\n", "utf8"),
      writeFile(path.join(stateDir, "daemon-journal.json"), "{\"entries\":[]}\n", "utf8"),
      writeFile(path.join(stateDir, "state", "doctor-last.json"), "{\"status\":\"warn\"}\n", "utf8"),
      writeFile(path.join(stateDir, "logs", "host-daemon.log"), "log\n", "utf8"),
      writeFile(path.join(stateDir, "backups", ".env.bak"), "backup\n", "utf8"),
      writeFile(launcherPath, "#!/bin/sh\npnpm dev:daemon\n", "utf8"),
      writeFile(unitPath, "[Service]\nExecStart=/tmp/launcher\n", "utf8"),
      writeFile(path.join(bootstrapRepoPath, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8")
    ]);

    await writeInstallState({
      result: installResult({
        repoRoot,
        platform: "linux",
        background: {
          mode: "systemd-user",
          status: "configured",
          detail: "systemd user service configured.",
          artifactPath: unitPath,
          launcherPath,
          ownedArtifacts: [
            {
              kind: "launcher",
              mode: "systemd-user",
              path: launcherPath
            },
            {
              kind: "systemd-user-unit",
              mode: "systemd-user",
              path: unitPath
            }
          ]
        }
      }),
      env: {
        HOME: homeDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "linux"
    });

    const result = await runHappyTGUninstall({
      json: true,
      cwd: repoRoot
    }, {
      env: {
        HOME: homeDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "linux",
      deps: {
        resolveExecutable: async (command) => command === "systemctl" ? `/usr/bin/${command}` : undefined,
        runCommand: async ({ command, args }) => {
          commands.push([command, ...(args ?? [])].join(" "));
          return commandResult(command);
        }
      }
    });

    assert.equal(result.status, "pass");
    assert.equal(await exists(path.join(repoRoot, ".env")), true);
    assert.equal(await exists(path.join(repoRoot, "README.md")), true);
    assert.equal(await exists(path.join(stateDir, "daemon-state.json")), false);
    assert.equal(await exists(path.join(stateDir, "logs")), false);
    assert.equal(await exists(launcherPath), false);
    assert.equal(await exists(unitPath), false);
    assert.equal(await exists(bootstrapRepoPath), false);
    assert.ok(commands.some((entry) => entry.includes("--user disable --now happytg-host-daemon.service")));
    assert.ok(commands.some((entry) => entry.includes("--user daemon-reload")));
    assert.ok(result.kept.some((item) => item.includes(`Repository checkout kept by design: ${repoRoot}`)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGUninstall removes both recorded Windows autorun artifacts after repeated installs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-uninstall-win-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, ".happytg-state");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.cmd");
  const startupPath = path.join(tempDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HappyTG Host Daemon.cmd");
  const commands: string[] = [];

  try {
    await Promise.all([
      mkdir(repoRoot, { recursive: true }),
      mkdir(path.join(stateDir, "state"), { recursive: true }),
      mkdir(path.join(stateDir, "bin"), { recursive: true }),
      mkdir(path.dirname(startupPath), { recursive: true })
    ]);

    await Promise.all([
      writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8"),
      writeFile(path.join(repoRoot, ".env"), "HAPPYTG_STATE_DIR=.happytg-state\n", "utf8"),
      writeFile(launcherPath, "@echo off\r\npnpm dev:daemon\r\n", "utf8"),
      writeFile(startupPath, "@echo off\r\ncall launcher\r\n", "utf8")
    ]);

    await writeInstallState({
      result: installResult({
        repoRoot,
        platform: "win32",
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
        repoRoot,
        platform: "win32",
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

    const result = await runHappyTGUninstall({
      json: true,
      cwd: repoRoot
    }, {
      env: {
        HOME: tempDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32",
      deps: {
        resolveExecutable: async (command) => command === "schtasks" ? `C:\\Windows\\System32\\${command}.exe` : undefined,
        runCommand: async ({ command, args }) => {
          commands.push([command, ...(args ?? [])].join(" "));
          return commandResult(command);
        }
      }
    });

    assert.equal(result.status, "pass");
    assert.equal(await exists(launcherPath), false);
    assert.equal(await exists(startupPath), false);
    assert.ok(commands.some((entry) => entry.includes("/Query /TN HappyTG Host Daemon")));
    assert.ok(commands.some((entry) => entry.includes("/Delete /F /TN HappyTG Host Daemon")));
    assert.ok(!result.kept.some((item) => item.includes("Skipped default Scheduled Task cleanup")));
    assert.ok(!result.kept.some((item) => item.includes("Skipped default Startup shortcut cleanup")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGUninstall does not query or remove unowned default Windows launchers for a custom state dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-uninstall-win-safe-"));
  const repoRoot = path.join(tempDir, "repo");
  const stateDir = path.join(tempDir, ".happytg-state");
  const launcherPath = path.join(stateDir, "bin", "happytg-daemon-launch.cmd");
  const startupPath = path.join(tempDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HappyTG Host Daemon.cmd");
  const commands: string[] = [];

  try {
    await Promise.all([
      mkdir(repoRoot, { recursive: true }),
      mkdir(path.join(stateDir, "bin"), { recursive: true }),
      mkdir(path.dirname(startupPath), { recursive: true })
    ]);

    await Promise.all([
      writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8"),
      writeFile(launcherPath, "@echo off\r\npnpm dev:daemon\r\n", "utf8"),
      writeFile(startupPath, "@echo off\r\ncall launcher\r\n", "utf8")
    ]);

    const result = await runHappyTGUninstall({
      json: true,
      cwd: repoRoot
    }, {
      env: {
        HOME: tempDir,
        HAPPYTG_STATE_DIR: stateDir
      },
      platform: "win32",
      deps: {
        resolveExecutable: async (command) => command === "schtasks" ? `C:\\Windows\\System32\\${command}.exe` : undefined,
        runCommand: async ({ command, args }) => {
          commands.push([command, ...(args ?? [])].join(" "));
          return commandResult(command);
        }
      }
    });

    assert.equal(result.status, "pass");
    assert.equal(await exists(launcherPath), false);
    assert.equal(await exists(startupPath), true);
    assert.deepEqual(commands, []);
    assert.ok(result.kept.some((item) => item.includes("Skipped default Scheduled Task cleanup")));
    assert.ok(result.kept.some((item) => item.includes("Skipped default Startup shortcut cleanup")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
