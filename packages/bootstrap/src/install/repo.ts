import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileExists } from "../../../shared/src/index.js";

import { CommandExecutionError, runCommand, type CommandRunResult } from "./commands.js";
import { createInstallRuntimeError, isRetryableRepoFailureMessage, repoFailureCode, repoFailureSuggestedAction } from "./errors.js";
import type {
  DirtyWorktreeStrategy,
  InstallRepoMode,
  InstallerRepoSource,
  RepoInspection,
  RepoModeChoice,
  RepoSelection,
  RepoSyncProgressEvent,
  RepoSyncResult
} from "./types.js";

async function directoryEntries(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  return (await directoryEntries(dirPath)).length === 0;
}

async function clearDirectoryContents(dirPath: string): Promise<void> {
  const entries = await directoryEntries(dirPath);
  await Promise.all(entries.map((entry) => fs.rm(path.join(dirPath, entry), { recursive: true, force: true })));
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function commandOutput(result: CommandRunResult, fallback: string): string {
  return result.stderr.trim() || result.stdout.trim() || fallback;
}

function installerRuntimeFromCommandError(input: {
  error: CommandExecutionError;
  repoUrl?: string;
  repoSource?: InstallerRepoSource["id"];
  fallbackUsed: boolean;
}): ReturnType<typeof createInstallRuntimeError> {
  const likelyWindowsShim = input.error.detail.likelyWindowsShim;
  return createInstallRuntimeError({
    code: likelyWindowsShim ? "windows_shim_failure" : "command_spawn_failure",
    message: input.error.message,
    lastError: input.error.message,
    retryable: false,
    suggestedAction: likelyWindowsShim
      ? `Open a new shell, verify \`${input.error.detail.failedBinary} --version\`, or reinstall the tool to repair the Windows shim before rerunning the installer.`
      : `Verify that ${input.error.detail.failedBinary} is installed and runnable in the current shell, then rerun the installer.`,
    repoUrl: input.repoUrl,
    repoSource: input.repoSource,
    failedCommand: input.error.detail.failedCommand,
    failedBinary: input.error.detail.failedBinary,
    binaryPath: input.error.detail.binaryPath,
    fallbackUsed: input.fallbackUsed
  });
}

async function prepareCloneTarget(input: {
  selection: RepoSelection;
  inspection: RepoInspection;
}): Promise<void> {
  if (input.selection.mode === "clone") {
    await fs.rm(input.selection.path, { recursive: true, force: true });
    await fs.mkdir(input.selection.path, { recursive: true });
    return;
  }

  if (input.selection.mode === "current" && input.inspection.emptyDirectory) {
    await clearDirectoryContents(input.inspection.path);
  }
}

async function syncRepositoryFromSource(input: {
  selection: RepoSelection;
  source: InstallerRepoSource;
  branch: string;
  currentInspection: RepoInspection;
  updateInspection: RepoInspection;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runCommandImpl?: typeof runCommand;
}): Promise<RepoSyncResult> {
  const targetPath = path.resolve(input.selection.path);
  const runner = input.runCommandImpl ?? runCommand;
  const git = (args: string[], cwd?: string) => runner({
    command: "git",
    args,
    cwd,
    env: input.env,
    platform: input.platform
  });

  if (input.selection.mode === "clone") {
    await prepareCloneTarget({
      selection: input.selection,
      inspection: input.updateInspection
    });
    const cloneRun = await git(["clone", "--branch", input.branch, input.source.url, targetPath]);
    if (cloneRun.exitCode !== 0) {
      throw new Error(commandOutput(cloneRun, "Git clone failed."));
    }

    return {
      path: targetPath,
      sync: "cloned",
      attempts: 1,
      repoSource: input.source.id,
      repoUrl: input.source.url,
      fallbackUsed: input.source.id === "fallback"
    };
  }

  const inspection = input.selection.mode === "current" ? input.currentInspection : input.updateInspection;
  if (!inspection.isRepo || !inspection.rootPath) {
    if (input.selection.mode === "current" && inspection.emptyDirectory) {
      await prepareCloneTarget({
        selection: input.selection,
        inspection
      });
      const cloneRun = await git(["clone", "--branch", input.branch, input.source.url, "."], inspection.path);
      if (cloneRun.exitCode !== 0) {
        throw new Error(commandOutput(cloneRun, "Git clone into current directory failed."));
      }

      return {
        path: targetPath,
        sync: "cloned",
        attempts: 1,
        repoSource: input.source.id,
        repoUrl: input.source.url,
        fallbackUsed: input.source.id === "fallback"
      };
    }

    throw createInstallRuntimeError({
      code: "command_execution_failure",
      message: `No Git checkout is available at ${targetPath}.`,
      lastError: `No Git checkout is available at ${targetPath}.`,
      retryable: false,
      suggestedAction: "Choose clone mode, point --repo-dir at an existing checkout, or rerun the installer from an initialized HappyTG repository.",
      repoUrl: input.source.url,
      repoSource: input.source.id,
      fallbackUsed: input.source.id === "fallback"
    });
  }

  if (inspection.dirty) {
    switch (input.selection.dirtyStrategy) {
      case "stash": {
        const stashRun = await git(["-C", inspection.rootPath, "stash", "push", "-u", "-m", "HappyTG installer safety stash"]);
        if (stashRun.exitCode !== 0) {
          throw createInstallRuntimeError({
            code: "command_execution_failure",
            message: commandOutput(stashRun, "Unable to stash local changes before update."),
            lastError: commandOutput(stashRun, "Unable to stash local changes before update."),
            retryable: false,
            suggestedAction: "Stash or commit the local changes manually, or rerun the installer with keep/cancel.",
            repoUrl: input.source.url,
            repoSource: input.source.id,
            fallbackUsed: input.source.id === "fallback"
          });
        }
        break;
      }
      case "keep":
        return {
          path: inspection.rootPath,
          sync: "reused",
          attempts: 0,
          repoSource: "local",
          repoUrl: inspection.remoteUrl ?? input.source.url,
          fallbackUsed: false
        };
      case "cancel":
      default:
        throw createInstallRuntimeError({
          code: "command_execution_failure",
          message: `Checkout at ${inspection.rootPath} has local changes. Choose stash or keep.`,
          lastError: `Checkout at ${inspection.rootPath} has local changes. Choose stash or keep.`,
          retryable: false,
          suggestedAction: "Rerun the installer and choose to stash local changes or keep the current checkout as-is.",
          repoUrl: input.source.url,
          repoSource: input.source.id,
          fallbackUsed: input.source.id === "fallback"
        });
    }
  }

  const fetchRun = await git(["-C", inspection.rootPath, "fetch", "--prune", input.source.url, input.branch]);
  if (fetchRun.exitCode !== 0) {
    throw new Error(commandOutput(fetchRun, "Git fetch failed."));
  }

  const checkoutRun = await git(["-C", inspection.rootPath, "checkout", input.branch]);
  if (checkoutRun.exitCode !== 0) {
    throw createInstallRuntimeError({
      code: "command_execution_failure",
      message: commandOutput(checkoutRun, `Unable to checkout ${input.branch}.`),
      lastError: commandOutput(checkoutRun, `Unable to checkout ${input.branch}.`),
      retryable: false,
      suggestedAction: `Verify that branch ${input.branch} exists locally or remotely, then rerun the installer.`,
      repoUrl: input.source.url,
      repoSource: input.source.id,
      fallbackUsed: input.source.id === "fallback"
    });
  }

  const pullRun = await git(["-C", inspection.rootPath, "pull", "--ff-only", input.source.url, input.branch]);
  if (pullRun.exitCode !== 0) {
    throw new Error(commandOutput(pullRun, "Git pull failed."));
  }

  return {
    path: inspection.rootPath,
    sync: "updated",
    attempts: 1,
    repoSource: input.source.id,
    repoUrl: input.source.url,
    fallbackUsed: input.source.id === "fallback"
  };
}

export function defaultClonePath(input: {
  launchCwd: string;
  bootstrapRepoRoot?: string;
}): string {
  const preferredParent = path.resolve(input.launchCwd);
  if (input.bootstrapRepoRoot && preferredParent === path.resolve(input.bootstrapRepoRoot)) {
    return path.join(os.homedir(), "HappyTG");
  }

  return path.join(preferredParent, "HappyTG");
}

export async function inspectRepo(input: {
  repoPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<RepoInspection> {
  const repoPath = path.resolve(input.repoPath);
  const exists = await fileExists(repoPath);
  if (!exists) {
    return {
      path: repoPath,
      exists: false,
      isRepo: false,
      emptyDirectory: false,
      dirty: false
    };
  }

  const stat = await fs.stat(repoPath);
  if (!stat.isDirectory()) {
    return {
      path: repoPath,
      exists: true,
      isRepo: false,
      emptyDirectory: false,
      dirty: false
    };
  }

  const emptyDirectory = await isDirectoryEmpty(repoPath);
  const topLevel = await runCommand({
    command: "git",
    args: ["-C", repoPath, "rev-parse", "--show-toplevel"],
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);
  if (!topLevel || topLevel.exitCode !== 0) {
    return {
      path: repoPath,
      exists: true,
      isRepo: false,
      emptyDirectory,
      dirty: false
    };
  }

  const rootPath = topLevel.stdout.trim().split(/\r?\n/u)[0]?.trim() ?? repoPath;
  const [statusRun, branchRun, remoteRun] = await Promise.all([
    runCommand({
      command: "git",
      args: ["-C", rootPath, "status", "--porcelain"],
      env: input.env,
      platform: input.platform
    }),
    runCommand({
      command: "git",
      args: ["-C", rootPath, "branch", "--show-current"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined),
    runCommand({
      command: "git",
      args: ["-C", rootPath, "remote", "get-url", "origin"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined)
  ]);

  return {
    path: repoPath,
    exists: true,
    isRepo: true,
    emptyDirectory,
    dirty: statusRun.stdout.trim().length > 0,
    rootPath,
    branch: branchRun?.exitCode === 0 ? branchRun.stdout.trim() : undefined,
    remoteUrl: remoteRun?.exitCode === 0 ? remoteRun.stdout.trim() : undefined
  };
}

export async function detectRepoModeChoices(input: {
  launchCwd: string;
  repoDir?: string;
  bootstrapRepoRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<{
  clonePath: string;
  currentInspection: RepoInspection;
  updateInspection: RepoInspection;
  choices: RepoModeChoice[];
}> {
  const currentPath = path.resolve(input.launchCwd);
  const clonePath = path.resolve(input.repoDir ?? defaultClonePath(input));
  const currentInspection = await inspectRepo({
    repoPath: currentPath,
    env: input.env,
    platform: input.platform
  });
  const updateInspection = clonePath === currentPath
    ? currentInspection
    : await inspectRepo({
      repoPath: clonePath,
      env: input.env,
      platform: input.platform
    });
  const currentIsBootstrapRepo = input.bootstrapRepoRoot
    ? currentInspection.rootPath === path.resolve(input.bootstrapRepoRoot)
    : false;

  return {
    clonePath,
    currentInspection,
    updateInspection,
    choices: [
      {
        mode: "clone",
        label: "Clone fresh checkout",
        path: clonePath,
        available: !updateInspection.exists || updateInspection.emptyDirectory,
        detail: !updateInspection.exists
          ? `Clone HappyTG into ${clonePath}.`
          : updateInspection.emptyDirectory
            ? `Clone HappyTG into the empty directory ${clonePath}.`
            : `${clonePath} already exists. Use update/current instead, or choose another target directory with --repo-dir.`
      },
      {
        mode: "update",
        label: "Update existing checkout",
        path: clonePath,
        available: updateInspection.isRepo,
        detail: updateInspection.isRepo
          ? updateInspection.dirty
            ? `${updateInspection.rootPath} is a Git checkout with local changes.`
            : `${updateInspection.rootPath} is a clean Git checkout ready for fetch/pull.`
          : `No existing Git checkout was detected at ${clonePath}.`
      },
      {
        mode: "current",
        label: "Use current directory",
        path: currentPath,
        available: !currentIsBootstrapRepo,
        detail: currentIsBootstrapRepo
          ? `${currentPath} is the bootstrap checkout used to launch the installer.`
          : currentInspection.isRepo
            ? currentInspection.dirty
              ? `${currentInspection.rootPath} is the current Git checkout and has local changes.`
              : `${currentInspection.rootPath} is the current Git checkout.`
            : currentInspection.emptyDirectory
              ? `${currentPath} is empty and can receive a clone directly.`
              : `${currentPath} is not a Git checkout. Use it only if you want to clone into the current directory.`
      }
    ]
  };
}

export function pickDefaultRepoMode(choices: RepoModeChoice[], explicitMode?: InstallRepoMode): InstallRepoMode {
  if (explicitMode) {
    return explicitMode;
  }

  const current = choices.find((choice) => choice.mode === "current" && choice.available && choice.detail.includes("Git checkout"));
  if (current) {
    return "current";
  }
  const update = choices.find((choice) => choice.mode === "update" && choice.available);
  if (update) {
    return "update";
  }
  return "clone";
}

export function defaultDirtyWorktreeStrategy(dirty: boolean, requested?: DirtyWorktreeStrategy): DirtyWorktreeStrategy {
  if (!dirty) {
    return "keep";
  }

  return requested ?? "cancel";
}

export async function syncRepository(input: {
  selection: RepoSelection;
  sources: InstallerRepoSource[];
  branch: string;
  currentInspection: RepoInspection;
  updateInspection: RepoInspection;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  maxAttempts?: number;
  retryDelayMs?: number;
  onProgress?: (event: RepoSyncProgressEvent) => void | Promise<void>;
  runCommandImpl?: typeof runCommand;
}): Promise<RepoSyncResult> {
  const maxAttempts = input.maxAttempts ?? 5;
  const retryDelayMs = input.retryDelayMs ?? 250;
  let totalAttempts = 0;

  for (let sourceIndex = 0; sourceIndex < input.sources.length; sourceIndex += 1) {
    const source = input.sources[sourceIndex]!;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      totalAttempts += 1;
      await input.onProgress?.({
        phase: "attempt",
        source,
        attempt,
        maxAttempts,
        detail: `${source.label}: attempt ${attempt}/${maxAttempts}`
      });

      try {
        const result = await syncRepositoryFromSource({
          selection: input.selection,
          source,
          branch: input.branch,
          currentInspection: input.currentInspection,
          updateInspection: input.updateInspection,
          env: input.env,
          platform: input.platform,
          runCommandImpl: input.runCommandImpl
        });
        return {
          ...result,
          attempts: totalAttempts
        };
      } catch (error) {
        if (error instanceof CommandExecutionError) {
          throw installerRuntimeFromCommandError({
            error,
            repoUrl: source.url,
            repoSource: source.id,
            fallbackUsed: source.id === "fallback"
          });
        }

        if (typeof error === "object" && error !== null && "detail" in error) {
          throw error;
        }

        const message = error instanceof Error ? error.message : "Repository sync failed.";
        const retryable = isRetryableRepoFailureMessage(message);
        const exhausted = attempt >= maxAttempts;
        const fallbackUsed = source.id === "fallback";
        const nextSource = input.sources[sourceIndex + 1];

        if (retryable && !exhausted) {
          const backoffMs = retryDelayMs * attempt;
          await input.onProgress?.({
            phase: "retry",
            source,
            attempt,
            maxAttempts,
            detail: `${source.label} attempt ${attempt}/${maxAttempts} failed. Retrying shortly.`,
            errorMessage: message,
            retryable: true,
            backoffMs
          });
          await sleep(backoffMs);
          continue;
        }

        if (retryable && exhausted && nextSource) {
          await input.onProgress?.({
            phase: "switch-source",
            source: nextSource,
            attempt,
            maxAttempts,
            detail: `${source.label} exhausted ${maxAttempts} attempts. Switching to ${nextSource.label}.`,
            errorMessage: message,
            retryable: true
          });
          break;
        }

        throw createInstallRuntimeError({
          code: repoFailureCode({
            repoSource: source.id,
            exhausted: retryable && exhausted
          }),
          message: retryable && exhausted
            ? `${source.label} remained unreachable after ${maxAttempts} attempts.`
            : `Repository sync failed via ${source.label}.`,
          lastError: message,
          retryable,
          suggestedAction: repoFailureSuggestedAction({
            repoSource: source.id,
            retryable,
            fallbackUsed
          }),
          attempts: totalAttempts,
          repoUrl: source.url,
          repoSource: source.id,
          fallbackUsed
        });
      }
    }
  }

  throw createInstallRuntimeError({
    code: "repo_fallback_failure",
    message: "Repository sync exhausted the configured sources.",
    lastError: "Repository sync exhausted the configured sources.",
    retryable: true,
    suggestedAction: "Check network connectivity to the configured repository sources, then rerun the installer.",
    attempts: totalAttempts,
    repoSource: "fallback",
    fallbackUsed: true
  });
}
