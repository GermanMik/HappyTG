import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  fileExists,
  findUpwardFile,
  getLocalStateDir,
  resolveExecutable,
  resolveHome
} from "../../../shared/src/index.js";
import { runCommand } from "../install/commands.js";
import { readInstallState } from "../install/state.js";
import {
  DEFAULT_WINDOWS_DAEMON_TASK_NAME,
  type OwnedBackgroundArtifact
} from "../install/types.js";

export type UninstallStatus = "pass" | "warn" | "fail";

export interface UninstallCommandOptions {
  json: boolean;
  cwd: string;
}

export interface UninstallCommandRecord {
  id: string;
  command: string;
  args: string[];
  status: "executed" | "failed" | "missing";
  detail: string;
}

export interface UninstallResult {
  kind: "uninstall";
  status: UninstallStatus;
  interactive: false;
  scope: {
    stateDir: string;
    bootstrapRepoPath: string;
    repoRoot?: string;
  };
  removedPaths: string[];
  missingPaths: string[];
  kept: string[];
  warnings: string[];
  reportJson: {
    commands: UninstallCommandRecord[];
    removedPaths: string[];
    missingPaths: string[];
    kept: string[];
  };
}

interface UninstallDependencies {
  resolveExecutable: typeof resolveExecutable;
  runCommand: typeof runCommand;
}

function defaultLocalStateDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string {
  const scopedEnv = { ...env };
  delete scopedEnv.HAPPYTG_STATE_DIR;
  return getLocalStateDir(scopedEnv, platform);
}

function normalizeComparePath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.win32.normalize(value).toLowerCase()
    : path.posix.normalize(value);
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return normalizeComparePath(left, platform) === normalizeComparePath(right, platform);
}

function pushUnique(values: string[], value: string | undefined): void {
  const normalized = value?.trim();
  if (!normalized || values.includes(normalized)) {
    return;
  }

  values.push(normalized);
}

function detectRepoRoot(cwd: string): string | undefined {
  const workspaceFile = findUpwardFile(cwd, "pnpm-workspace.yaml");
  if (workspaceFile) {
    return path.dirname(workspaceFile);
  }

  const packageFile = findUpwardFile(cwd, "package.json");
  return packageFile ? path.dirname(packageFile) : undefined;
}

function defaultLauncherPath(stateDir: string, platform: NodeJS.Platform): string {
  return path.join(stateDir, "bin", platform === "win32" ? "happytg-daemon-launch.cmd" : "happytg-daemon-launch.sh");
}

function uninstallKeptItems(repoRoot?: string): string[] {
  return [
    repoRoot
      ? `Repository checkout kept by design: ${repoRoot}`
      : "Repository checkout was not removed by design.",
    "Repo `.env`, Docker Compose services, and remote control-plane data were not touched."
  ];
}

function cleanupFailureMessage(action: string, error: unknown): string {
  return error instanceof Error ? `${action}: ${error.message}` : `${action}: unknown error`;
}

async function removePath(input: {
  targetPath: string;
  recursive?: boolean;
  removedPaths: string[];
  missingPaths: string[];
  warnings: string[];
}): Promise<void> {
  if (!(await fileExists(input.targetPath))) {
    pushUnique(input.missingPaths, input.targetPath);
    return;
  }

  try {
    await rm(input.targetPath, {
      recursive: input.recursive ?? false,
      force: true
    });
    pushUnique(input.removedPaths, input.targetPath);
  } catch (error) {
    pushUnique(input.warnings, cleanupFailureMessage(`Failed to remove ${input.targetPath}`, error));
  }
}

async function removeEmptyDir(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!(await fileExists(targetPath))) {
    return;
  }

  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      return;
    }

    await rmdir(targetPath);
    pushUnique(removedPaths, targetPath);
  } catch {
    // Leave non-empty or in-use directories in place silently.
  }
}

async function runCleanupCommand(input: {
  id: string;
  commandName: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  commands: UninstallCommandRecord[];
  warnings: string[];
  deps: UninstallDependencies;
  warnOnMissing?: string;
  warnOnFailure?: string;
}): Promise<{ executed: boolean; exitCode?: number }> {
  const binaryPath = await input.deps.resolveExecutable(input.commandName, {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!binaryPath) {
    input.commands.push({
      id: input.id,
      command: input.commandName,
      args: input.args,
      status: "missing",
      detail: `${input.commandName} was not found in PATH.`
    });
    pushUnique(input.warnings, input.warnOnMissing);
    return {
      executed: false
    };
  }

  try {
    const result = await input.deps.runCommand({
      command: binaryPath,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      platform: input.platform
    });
    input.commands.push({
      id: input.id,
      command: binaryPath,
      args: input.args,
      status: result.exitCode === 0 ? "executed" : "failed",
      detail: result.exitCode === 0
        ? "Command completed."
        : (result.stderr.trim() || result.stdout.trim() || `Exit code ${result.exitCode}.`)
    });
    if (result.exitCode !== 0) {
      pushUnique(input.warnings, input.warnOnFailure);
    }

    return {
      executed: true,
      exitCode: result.exitCode
    };
  } catch (error) {
    input.commands.push({
      id: input.id,
      command: binaryPath,
      args: input.args,
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown command failure."
    });
    pushUnique(input.warnings, input.warnOnFailure ?? cleanupFailureMessage(`Failed to run ${input.commandName}`, error));
    return {
      executed: true,
      exitCode: 1
    };
  }
}

function normalizeOwnedArtifacts(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stateDir: string;
  usesDefaultStateScope: boolean;
  recordedArtifacts: OwnedBackgroundArtifact[];
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

  const seen = new Set<string>();
  const normalized: OwnedBackgroundArtifact[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "scheduled-task") {
      const taskName = artifact.taskName?.trim() || DEFAULT_WINDOWS_DAEMON_TASK_NAME;
      const key = `scheduled-task:${taskName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        normalized.push({
          kind: "scheduled-task",
          mode: artifact.mode,
          taskName
        });
      }
      continue;
    }

    const normalizedPath = artifact.path?.trim();
    if (!normalizedPath) {
      continue;
    }

    const key = `${artifact.kind}:${normalizeComparePath(normalizedPath, input.platform)}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push({
        kind: artifact.kind,
        mode: artifact.mode,
        path: normalizedPath
      });
    }
  }

  return normalized;
}

function bootstrapRepoScope(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stateDir: string;
}): {
  configuredPath: string;
  removablePath?: string;
  keptMessage?: string;
} {
  const defaultPath = path.join(input.stateDir, "bootstrap-repo");
  const configuredPath = resolveHome(input.env.HAPPYTG_BOOTSTRAP_DIR ?? defaultPath, {
    env: input.env,
    platform: input.platform
  });

  if (!samePath(configuredPath, defaultPath, input.platform)) {
    return {
      configuredPath,
      keptMessage: `Bootstrap checkout kept by design: ${configuredPath}`
    };
  }

  return {
    configuredPath,
    removablePath: configuredPath
  };
}

async function cleanupBackgroundArtifacts(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stateDir: string;
  removedPaths: string[];
  missingPaths: string[];
  kept: string[];
  warnings: string[];
  commands: UninstallCommandRecord[];
  deps: UninstallDependencies;
}): Promise<void> {
  const installState = await readInstallState({
    env: input.env,
    platform: input.platform
  });
  const usesDefaultStateScope = samePath(
    input.stateDir,
    defaultLocalStateDir(input.env, input.platform),
    input.platform
  );
  const recordedArtifacts = installState?.background.ownedArtifacts ?? [];
  const recordedKinds = new Set(recordedArtifacts.map((artifact) => artifact.kind));

  if (!usesDefaultStateScope) {
    if (input.platform === "darwin" && !recordedKinds.has("launchagent")) {
      pushUnique(input.kept, "Skipped default LaunchAgent cleanup because custom HAPPYTG_STATE_DIR had no recorded LaunchAgent artifact.");
    }
    if (input.platform === "linux" && !recordedKinds.has("systemd-user-unit")) {
      pushUnique(input.kept, "Skipped default systemd user service cleanup because custom HAPPYTG_STATE_DIR had no recorded service artifact.");
    }
    if (input.platform === "win32") {
      if (!recordedKinds.has("scheduled-task")) {
        pushUnique(input.kept, "Skipped default Scheduled Task cleanup because custom HAPPYTG_STATE_DIR had no recorded scheduled-task ownership.");
      }
      if (!recordedKinds.has("startup-shortcut")) {
        pushUnique(input.kept, "Skipped default Startup shortcut cleanup because custom HAPPYTG_STATE_DIR had no recorded startup artifact.");
      }
    }
  }

  const artifacts = normalizeOwnedArtifacts({
    env: input.env,
    platform: input.platform,
    stateDir: input.stateDir,
    usesDefaultStateScope,
    recordedArtifacts
  });

  const launchAgents = artifacts.filter((artifact): artifact is OwnedBackgroundArtifact & { path: string } =>
    artifact.kind === "launchagent" && typeof artifact.path === "string"
  );
  const systemdUnits = artifacts.filter((artifact): artifact is OwnedBackgroundArtifact & { path: string } =>
    artifact.kind === "systemd-user-unit" && typeof artifact.path === "string"
  );
  const startupShortcuts = artifacts.filter((artifact): artifact is OwnedBackgroundArtifact & { path: string } =>
    artifact.kind === "startup-shortcut" && typeof artifact.path === "string"
  );
  const launcherScripts = artifacts.filter((artifact): artifact is OwnedBackgroundArtifact & { path: string } =>
    artifact.kind === "launcher" && typeof artifact.path === "string"
  );
  const scheduledTasks = artifacts.filter((artifact): artifact is OwnedBackgroundArtifact & { taskName: string } =>
    artifact.kind === "scheduled-task" && typeof artifact.taskName === "string"
  );

  for (const launchAgent of launchAgents) {
    if (!(await fileExists(launchAgent.path))) {
      pushUnique(input.missingPaths, launchAgent.path);
      continue;
    }

    await runCleanupCommand({
      id: "launchctl-bootout",
      commandName: "launchctl",
      args: ["bootout", `gui/${process.getuid?.() ?? 0}`, launchAgent.path],
      cwd: input.cwd,
      env: input.env,
      platform: input.platform,
      commands: input.commands,
      warnings: input.warnings,
      deps: input.deps,
      warnOnMissing: "launchctl is unavailable, so the LaunchAgent could not be unloaded automatically before file removal.",
      warnOnFailure: "launchctl bootout did not complete cleanly. The LaunchAgent file was still removed, but the current user session may need a logout or manual cleanup."
    });
    await removePath({
      targetPath: launchAgent.path,
      removedPaths: input.removedPaths,
      missingPaths: input.missingPaths,
      warnings: input.warnings
    });
  }

  let systemdDisableRan = false;
  let systemdDisableExecuted = false;
  for (const unit of systemdUnits) {
    if (!(await fileExists(unit.path))) {
      pushUnique(input.missingPaths, unit.path);
      continue;
    }

    if (!systemdDisableRan) {
      const disableResult = await runCleanupCommand({
        id: "systemctl-disable",
        commandName: "systemctl",
        args: ["--user", "disable", "--now", "happytg-host-daemon.service"],
        cwd: input.cwd,
        env: input.env,
        platform: input.platform,
        commands: input.commands,
        warnings: input.warnings,
        deps: input.deps,
        warnOnMissing: "systemctl is unavailable, so the user service could not be disabled automatically before file removal.",
        warnOnFailure: "systemctl disable --now did not complete cleanly. The unit file was still removed, but the current user session may still hold stale service state."
      });
      systemdDisableRan = true;
      systemdDisableExecuted = disableResult.executed;
    }

    await removePath({
      targetPath: unit.path,
      removedPaths: input.removedPaths,
      missingPaths: input.missingPaths,
      warnings: input.warnings
    });
  }

  if (systemdDisableExecuted) {
    await runCleanupCommand({
      id: "systemctl-daemon-reload",
      commandName: "systemctl",
      args: ["--user", "daemon-reload"],
      cwd: input.cwd,
      env: input.env,
      platform: input.platform,
      commands: input.commands,
      warnings: input.warnings,
      deps: input.deps
    });
  }

  for (const task of scheduledTasks) {
    const taskQuery = await runCleanupCommand({
      id: "schtasks-query",
      commandName: "schtasks",
      args: ["/Query", "/TN", task.taskName],
      cwd: input.cwd,
      env: input.env,
      platform: input.platform,
      commands: input.commands,
      warnings: input.warnings,
      deps: input.deps,
      warnOnMissing: recordedKinds.has("scheduled-task")
        ? "schtasks.exe is unavailable, so the HappyTG Scheduled Task could not be queried or removed automatically."
        : undefined
    });

    if (taskQuery.executed && taskQuery.exitCode === 0) {
      await runCleanupCommand({
        id: "schtasks-delete",
        commandName: "schtasks",
        args: ["/Delete", "/F", "/TN", task.taskName],
        cwd: input.cwd,
        env: input.env,
        platform: input.platform,
        commands: input.commands,
        warnings: input.warnings,
        deps: input.deps,
        warnOnFailure: "Scheduled Task removal did not complete cleanly. Delete the `HappyTG Host Daemon` task manually if it is still present."
      });
    }
  }

  for (const startupShortcut of startupShortcuts) {
    await removePath({
      targetPath: startupShortcut.path,
      removedPaths: input.removedPaths,
      missingPaths: input.missingPaths,
      warnings: input.warnings
    });
  }

  for (const launcherScript of launcherScripts) {
    await removePath({
      targetPath: launcherScript.path,
      removedPaths: input.removedPaths,
      missingPaths: input.missingPaths,
      warnings: input.warnings
    });
  }
}

export async function runHappyTGUninstall(
  options: UninstallCommandOptions,
  runtime?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    deps?: Partial<UninstallDependencies>;
  }
): Promise<UninstallResult> {
  const env = runtime?.env ?? process.env;
  const platform = runtime?.platform ?? process.platform;
  const deps: UninstallDependencies = {
    resolveExecutable: runtime?.deps?.resolveExecutable ?? resolveExecutable,
    runCommand: runtime?.deps?.runCommand ?? runCommand
  };

  const stateDir = getLocalStateDir(env, platform);
  const repoRoot = detectRepoRoot(options.cwd);
  const kept = uninstallKeptItems(repoRoot);
  const removedPaths: string[] = [];
  const missingPaths: string[] = [];
  const warnings: string[] = [];
  const commands: UninstallCommandRecord[] = [];

  const bootstrapScope = bootstrapRepoScope({
    env,
    platform,
    stateDir
  });
  pushUnique(kept, bootstrapScope.keptMessage);

  await cleanupBackgroundArtifacts({
    cwd: options.cwd,
    env,
    platform,
    stateDir,
    removedPaths,
    missingPaths,
    kept,
    warnings,
    commands,
    deps
  });

  for (const filePath of [
    path.join(stateDir, "daemon-state.json"),
    path.join(stateDir, "daemon-journal.json"),
    path.join(stateDir, "state", "install-last.json"),
    path.join(stateDir, "state", "install-draft.json"),
    path.join(stateDir, "state", "doctor-last.json"),
    path.join(stateDir, "state", "setup-last.json"),
    path.join(stateDir, "state", "repair-last.json"),
    path.join(stateDir, "state", "verify-last.json"),
    path.join(stateDir, "state", "status-last.json"),
    path.join(stateDir, "state", "config-init-last.json"),
    path.join(stateDir, "state", "env-snapshot-last.json")
  ]) {
    await removePath({
      targetPath: filePath,
      removedPaths,
      missingPaths,
      warnings
    });
  }

  for (const dirPath of [
    path.join(stateDir, "logs"),
    path.join(stateDir, "backups")
  ]) {
    await removePath({
      targetPath: dirPath,
      recursive: true,
      removedPaths,
      missingPaths,
      warnings
    });
  }

  if (bootstrapScope.removablePath) {
    await removePath({
      targetPath: bootstrapScope.removablePath,
      recursive: true,
      removedPaths,
      missingPaths,
      warnings
    });
  }

  await removeEmptyDir(path.join(stateDir, "bin"), removedPaths);
  await removeEmptyDir(path.join(stateDir, "state"), removedPaths);
  await removeEmptyDir(stateDir, removedPaths);

  const status: UninstallStatus = warnings.length > 0 ? "warn" : "pass";

  return {
    kind: "uninstall",
    status,
    interactive: false,
    scope: {
      stateDir,
      bootstrapRepoPath: bootstrapScope.configuredPath,
      repoRoot
    },
    removedPaths,
    missingPaths,
    kept,
    warnings,
    reportJson: {
      commands,
      removedPaths,
      missingPaths,
      kept
    }
  };
}

export function createUninstallFailureResult(input: {
  cwd: string;
  error: unknown;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): UninstallResult {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const stateDir = getLocalStateDir(env, platform);
  const repoRoot = detectRepoRoot(input.cwd);
  const bootstrapRepoPath = resolveHome(env.HAPPYTG_BOOTSTRAP_DIR ?? path.join(stateDir, "bootstrap-repo"), {
    env,
    platform
  });
  const message = input.error instanceof Error ? input.error.message : "Unknown uninstall failure.";

  return {
    kind: "uninstall",
    status: "fail",
    interactive: false,
    scope: {
      stateDir,
      bootstrapRepoPath,
      repoRoot
    },
    removedPaths: [],
    missingPaths: [],
    kept: uninstallKeptItems(repoRoot),
    warnings: [message],
    reportJson: {
      commands: [],
      removedPaths: [],
      missingPaths: [],
      kept: uninstallKeptItems(repoRoot)
    }
  };
}
