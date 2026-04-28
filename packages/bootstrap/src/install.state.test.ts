import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readInstallState, writeInstallState } from "./install/state.js";
import type { InstallResult } from "./install/types.js";

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

test("writeInstallState keeps recorded launcher ownership across repeated background-mode installs", async () => {
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
          mode: "scheduled-task",
          path: launcherPath
        },
        {
          kind: "scheduled-task",
          mode: "scheduled-task",
          taskName: "HappyTG Host Daemon"
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
