import { chmod, rm } from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  fileExists,
  getLocalStateDir,
  resolveHome,
  resolveExecutable,
  writeTextFileAtomic
} from "../../../shared/src/index.js";

import { runCommand } from "./commands.js";
import {
  DEFAULT_WINDOWS_DAEMON_TASK_NAME,
  type BackgroundMode,
  type BackgroundSetupResult,
  type OwnedBackgroundArtifact
} from "./types.js";
import { normalizeOwnedBackgroundArtifacts, readInstallState } from "./state.js";
import type { CommandRunResult } from "./commands.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeComparePath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.win32.normalize(value).toLowerCase()
    : path.posix.normalize(value);
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return normalizeComparePath(left, platform) === normalizeComparePath(right, platform);
}

function defaultLocalStateDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const withoutOverride: NodeJS.ProcessEnv = {
    ...env
  };
  delete withoutOverride.HAPPYTG_STATE_DIR;
  return getLocalStateDir(withoutOverride, platform);
}

function defaultLauncherPath(stateDir: string, platform: NodeJS.Platform): string {
  return path.join(stateDir, "bin", platform === "win32" ? "happytg-daemon-launch.cmd" : "happytg-daemon-launch.sh");
}

function pushUnique(lines: string[], line: string): void {
  const normalized = line.trim();
  if (normalized && !lines.includes(normalized)) {
    lines.push(normalized);
  }
}

function defaultBackgroundArtifacts(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stateDir: string;
  usesDefaultStateScope: boolean;
  recordedArtifacts: readonly OwnedBackgroundArtifact[];
}): OwnedBackgroundArtifact[] {
  const artifacts: OwnedBackgroundArtifact[] = [
    ...input.recordedArtifacts,
    {
      kind: "launcher",
      mode: "manual",
      path: defaultLauncherPath(input.stateDir, input.platform)
    }
  ];

  if (input.usesDefaultStateScope) {
    if (input.platform === "darwin") {
      artifacts.push({
        kind: "launchagent",
        mode: "launchagent",
        path: resolveHome("~/Library/LaunchAgents/dev.happytg.host-daemon.plist", {
          env: input.env,
          platform: input.platform
        })
      });
    }

    if (input.platform === "linux") {
      artifacts.push({
        kind: "systemd-user-unit",
        mode: "systemd-user",
        path: resolveHome("~/.config/systemd/user/happytg-host-daemon.service", {
          env: input.env,
          platform: input.platform
        })
      });
    }

    if (input.platform === "win32") {
      artifacts.push({
        kind: "scheduled-task",
        mode: "scheduled-task",
        taskName: DEFAULT_WINDOWS_DAEMON_TASK_NAME
      });
      artifacts.push({
        kind: "startup-shortcut",
        mode: "startup",
        path: resolveHome("~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/HappyTG Host Daemon.cmd", {
          env: input.env,
          platform: input.platform
        })
      });
    }
  }

  return normalizeOwnedBackgroundArtifacts(artifacts, input.platform);
}

async function removeBackgroundPath(input: {
  targetPath: string;
  removedPaths: string[];
  missingPaths: string[];
  warnings: string[];
}): Promise<void> {
  if (!(await fileExists(input.targetPath))) {
    pushUnique(input.missingPaths, input.targetPath);
    return;
  }

  try {
    await rm(input.targetPath, { force: true, recursive: false });
    pushUnique(input.removedPaths, input.targetPath);
  } catch (error) {
    pushUnique(input.warnings, `Failed to remove ${input.targetPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runResetCommand(input: {
  id: string;
  commandName: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  warnings: string[];
  commands: BackgroundResetCommandRecord[];
  resolveExecutableImpl: typeof resolveExecutable;
  runCommandImpl: typeof runCommand;
  warnOnMissing?: string;
  warnOnFailure?: string;
}): Promise<{ executed: boolean; exitCode?: number }> {
  const executable = await input.resolveExecutableImpl(input.commandName, {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!executable) {
    if (input.warnOnMissing) {
      pushUnique(input.warnings, input.warnOnMissing);
    }
    input.commands.push({
      id: input.id,
      command: input.commandName,
      args: input.args,
      status: "skipped"
    });
    return { executed: false };
  }

  const result: CommandRunResult = await input.runCommandImpl({
    command: executable,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  }).catch((error) => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : "Command failed.",
    exitCode: 1,
    binaryPath: executable,
    shell: false,
    fallbackUsed: false
  }));

  input.commands.push({
    id: input.id,
    command: executable,
    args: input.args,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  });
  if (result.exitCode !== 0 && input.warnOnFailure) {
    pushUnique(input.warnings, input.warnOnFailure);
  }

  return {
    executed: true,
    exitCode: result.exitCode
  };
}

export interface BackgroundResetCommandRecord {
  id: string;
  command: string;
  args: string[];
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface BackgroundResetResult {
  removedPaths: string[];
  missingPaths: string[];
  kept: string[];
  warnings: string[];
  commands: BackgroundResetCommandRecord[];
}

export async function resetBackgroundModeArtifacts(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resolveExecutableImpl?: typeof resolveExecutable;
  runCommandImpl?: typeof runCommand;
}): Promise<BackgroundResetResult> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const stateDir = getLocalStateDir(env, platform);
  const usesDefaultStateScope = samePath(stateDir, defaultLocalStateDir(env, platform), platform);
  const installState = await readInstallState({
    env,
    platform
  });
  const recordedArtifacts = installState?.background.ownedArtifacts ?? [];
  const recordedKinds = new Set(recordedArtifacts.map((artifact) => artifact.kind));
  const removedPaths: string[] = [];
  const missingPaths: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];
  const commands: BackgroundResetCommandRecord[] = [];
  const resolveExecutableImpl = input.resolveExecutableImpl ?? resolveExecutable;
  const runCommandImpl = input.runCommandImpl ?? runCommand;

  if (!usesDefaultStateScope) {
    if (platform === "darwin" && !recordedKinds.has("launchagent")) {
      pushUnique(kept, "Skipped default LaunchAgent reset because custom HAPPYTG_STATE_DIR had no recorded LaunchAgent artifact.");
    }
    if (platform === "linux" && !recordedKinds.has("systemd-user-unit")) {
      pushUnique(kept, "Skipped default systemd user service reset because custom HAPPYTG_STATE_DIR had no recorded service artifact.");
    }
    if (platform === "win32") {
      if (!recordedKinds.has("scheduled-task")) {
        pushUnique(kept, "Skipped default Scheduled Task reset because custom HAPPYTG_STATE_DIR had no recorded scheduled-task ownership.");
      }
      if (!recordedKinds.has("startup-shortcut")) {
        pushUnique(kept, "Skipped default Startup shortcut reset because custom HAPPYTG_STATE_DIR had no recorded startup artifact.");
      }
    }
  }

  const artifacts = defaultBackgroundArtifacts({
    env,
    platform,
    stateDir,
    usesDefaultStateScope,
    recordedArtifacts
  });

  for (const artifact of artifacts.filter((item) => item.kind === "launchagent" && item.path)) {
    await runResetCommand({
      id: "launchctl-bootout",
      commandName: "launchctl",
      args: ["bootout", `gui/${process.getuid?.() ?? 0}`, artifact.path!],
      cwd: input.cwd,
      env,
      platform,
      warnings,
      commands,
      resolveExecutableImpl,
      runCommandImpl
    });
    await removeBackgroundPath({ targetPath: artifact.path!, removedPaths, missingPaths, warnings });
  }

  let systemdDisableExecuted = false;
  const systemdUnits = artifacts.filter((item) => item.kind === "systemd-user-unit" && item.path);
  if (systemdUnits.length > 0) {
    const disableResult = await runResetCommand({
      id: "systemctl-disable",
      commandName: "systemctl",
      args: ["--user", "disable", "--now", "happytg-host-daemon.service"],
      cwd: input.cwd,
      env,
      platform,
      warnings,
      commands,
      resolveExecutableImpl,
      runCommandImpl,
      warnOnFailure: "systemctl disable --now did not complete cleanly. Remove the stale HappyTG user service manually if it is still active."
    });
    systemdDisableExecuted = disableResult.executed;
  }
  for (const artifact of systemdUnits) {
    await removeBackgroundPath({ targetPath: artifact.path!, removedPaths, missingPaths, warnings });
  }
  if (systemdDisableExecuted) {
    await runResetCommand({
      id: "systemctl-daemon-reload",
      commandName: "systemctl",
      args: ["--user", "daemon-reload"],
      cwd: input.cwd,
      env,
      platform,
      warnings,
      commands,
      resolveExecutableImpl,
      runCommandImpl
    });
  }

  for (const artifact of artifacts.filter((item) => item.kind === "scheduled-task")) {
    const taskName = artifact.taskName ?? DEFAULT_WINDOWS_DAEMON_TASK_NAME;
    const query = await runResetCommand({
      id: "schtasks-query",
      commandName: "schtasks",
      args: ["/Query", "/TN", taskName],
      cwd: input.cwd,
      env,
      platform,
      warnings,
      commands,
      resolveExecutableImpl,
      runCommandImpl,
      warnOnMissing: recordedKinds.has("scheduled-task")
        ? "schtasks.exe is unavailable, so the recorded HappyTG Scheduled Task could not be queried or reset automatically."
        : undefined
    });
    if (query.executed && query.exitCode === 0) {
      await runResetCommand({
        id: "schtasks-delete",
        commandName: "schtasks",
        args: ["/Delete", "/F", "/TN", taskName],
        cwd: input.cwd,
        env,
        platform,
        warnings,
        commands,
        resolveExecutableImpl,
        runCommandImpl,
        warnOnFailure: "Scheduled Task reset did not complete cleanly. Delete the `HappyTG Host Daemon` task manually if it is still present."
      });
    }
  }

  for (const artifact of artifacts.filter((item) => item.kind !== "scheduled-task" && item.path)) {
    if (artifact.kind === "launchagent" || artifact.kind === "systemd-user-unit") {
      continue;
    }
    await removeBackgroundPath({ targetPath: artifact.path!, removedPaths, missingPaths, warnings });
  }

  return {
    removedPaths,
    missingPaths,
    kept,
    warnings,
    commands
  };
}

async function writeLauncherScript(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<string> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const stateDir = getLocalStateDir(env, platform);
  const binDir = path.join(stateDir, "bin");
  await ensureDir(binDir);

  if (platform === "win32") {
    const launcherPath = path.join(binDir, "happytg-daemon-launch.cmd");
    const content = [
      "@echo off",
      `cd /d "${input.repoRoot}"`,
      "pnpm dev:daemon"
    ].join("\r\n");
    await writeTextFileAtomic(launcherPath, `${content}\r\n`);
    return launcherPath;
  }

  const launcherPath = path.join(binDir, "happytg-daemon-launch.sh");
  const content = [
    "#!/bin/sh",
    `cd ${shellQuote(input.repoRoot)}`,
    "exec pnpm dev:daemon"
  ].join("\n");
  await writeTextFileAtomic(launcherPath, `${content}\n`);
  await chmod(launcherPath, 0o755);
  return launcherPath;
}

async function configureLaunchAgent(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const plistPath = resolveHome("~/Library/LaunchAgents/dev.happytg.host-daemon.plist", {
    env: input.env,
    platform: input.platform
  });
  const stateDir = getLocalStateDir(input.env, input.platform);
  const label = "dev.happytg.host-daemon";
  const plist = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${launcherPath}</string>`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>WorkingDirectory</key>",
    `  <string>${input.repoRoot}</string>`,
    "  <key>StandardOutPath</key>",
    `  <string>${path.join(stateDir, "logs", "host-daemon.out.log")}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${path.join(stateDir, "logs", "host-daemon.err.log")}</string>`,
    "</dict>",
    "</plist>"
  ].join("\n");
  await ensureDir(path.dirname(plistPath));
  await ensureDir(path.join(stateDir, "logs"));
  await writeTextFileAtomic(plistPath, `${plist}\n`);

  const launchctl = await resolveExecutable("launchctl", {
    env: input.env,
    platform: input.platform
  });
  if (launchctl) {
    await runCommand({
      command: launchctl,
      args: ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
    await runCommand({
      command: launchctl,
      args: ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
  }

  return {
    mode: "launchagent",
    status: "configured",
    detail: `LaunchAgent configured at ${plistPath}.`,
    artifactPath: plistPath,
    launcherPath,
    ownedArtifacts: [
      {
        kind: "launcher",
        mode: "launchagent",
        path: launcherPath
      },
      {
        kind: "launchagent",
        mode: "launchagent",
        path: plistPath
      }
    ]
  };
}

async function configureScheduledTask(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const schtasks = await resolveExecutable("schtasks", {
    env: input.env,
    platform: input.platform
  });
  if (!schtasks) {
    return {
      mode: "scheduled-task",
      status: "manual",
      detail: "schtasks.exe was not found. Create a logon task manually after install.",
      launcherPath,
      ownedArtifacts: [
        {
          kind: "launcher",
          mode: "scheduled-task",
          path: launcherPath
        }
      ]
    };
  }

  await runCommand({
    command: schtasks,
    args: ["/Create", "/F", "/SC", "ONLOGON", "/TN", "HappyTG Host Daemon", "/TR", `"${launcherPath}"`],
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);

  return {
    mode: "scheduled-task",
    status: "configured",
    detail: "Scheduled Task configured for HappyTG Host Daemon.",
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
        taskName: DEFAULT_WINDOWS_DAEMON_TASK_NAME
      }
    ]
  };
}

async function configureStartupShortcut(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const startupDir = resolveHome("~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup", {
    env: input.env,
    platform: input.platform
  });
  const shortcutPath = path.join(startupDir, "HappyTG Host Daemon.cmd");
  await ensureDir(startupDir);
  const launcherExists = await fileExists(launcherPath);
  if (!launcherExists) {
    return {
      mode: "startup",
      status: "failed",
      detail: "Startup launcher could not be created.",
      launcherPath
    };
  }

  await writeTextFileAtomic(shortcutPath, `@echo off\r\ncall "${launcherPath}"\r\n`);
  return {
    mode: "startup",
    status: "configured",
    detail: `Startup shortcut created at ${shortcutPath}.`,
    artifactPath: shortcutPath,
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
        path: shortcutPath
      }
    ]
  };
}

async function configureSystemdUser(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const unitPath = resolveHome("~/.config/systemd/user/happytg-host-daemon.service", {
    env: input.env,
    platform: input.platform
  });
  const unit = [
    "[Unit]",
    "Description=HappyTG Host Daemon",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${input.repoRoot}`,
    `ExecStart=${launcherPath}`,
    "Restart=always",
    "",
    "[Install]",
    "WantedBy=default.target"
  ].join("\n");

  await ensureDir(path.dirname(unitPath));
  await writeTextFileAtomic(unitPath, `${unit}\n`);
  const systemctl = await resolveExecutable("systemctl", {
    env: input.env,
    platform: input.platform
  });
  if (systemctl) {
    await runCommand({
      command: systemctl,
      args: ["--user", "daemon-reload"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
    await runCommand({
      command: systemctl,
      args: ["--user", "enable", "--now", "happytg-host-daemon.service"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
  }

  return {
    mode: "systemd-user",
    status: "configured",
    detail: `systemd user service written to ${unitPath}.`,
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
  };
}

export async function configureBackgroundMode(input: {
  mode: BackgroundMode;
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  switch (input.mode) {
    case "launchagent":
      return configureLaunchAgent(input);
    case "scheduled-task":
      return configureScheduledTask(input);
    case "startup":
      return configureStartupShortcut(input);
    case "systemd-user":
      return configureSystemdUser(input);
    case "manual":
      return {
        mode: "manual",
        status: "manual",
        detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
      };
    case "skip":
    default:
      return {
        mode: "skip",
        status: "skipped",
        detail: "Background daemon setup was skipped."
      };
  }
}
