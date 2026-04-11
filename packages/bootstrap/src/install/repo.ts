import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileExists } from "../../../shared/src/index.js";

import { runCommand } from "./commands.js";
import type {
  DirtyWorktreeStrategy,
  InstallRepoMode,
  RepoInspection,
  RepoModeChoice,
  RepoSelection
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
  repoUrl: string;
  branch: string;
  currentInspection: RepoInspection;
  updateInspection: RepoInspection;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<{
  path: string;
  sync: "cloned" | "updated" | "reused";
}> {
  const targetPath = path.resolve(input.selection.path);
  const git = (args: string[], cwd?: string) => runCommand({
    command: "git",
    args,
    cwd,
    env: input.env,
    platform: input.platform
  });

  if (input.selection.mode === "clone") {
    await fs.mkdir(targetPath, { recursive: true });
    const cloneArgs = [
      "clone",
      "--branch",
      input.branch,
      input.repoUrl,
      targetPath === input.selection.path ? targetPath : input.selection.path
    ];
    const result = await git(cloneArgs);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "Git clone failed.");
    }

    return {
      path: targetPath,
      sync: "cloned"
    };
  }

  const inspection = input.selection.mode === "current" ? input.currentInspection : input.updateInspection;
  if (!inspection.isRepo || !inspection.rootPath) {
    if (input.selection.mode === "current" && inspection.emptyDirectory) {
      const result = await git(["clone", "--branch", input.branch, input.repoUrl, "."], inspection.path);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || "Git clone into current directory failed.");
      }

      return {
        path: targetPath,
        sync: "cloned"
      };
    }

    throw new Error(`No Git checkout is available at ${targetPath}.`);
  }

  if (inspection.dirty) {
    switch (input.selection.dirtyStrategy) {
      case "stash": {
        const stashRun = await git(["-C", inspection.rootPath, "stash", "push", "-u", "-m", "HappyTG installer safety stash"]);
        if (stashRun.exitCode !== 0) {
          throw new Error(stashRun.stderr.trim() || "Unable to stash local changes before update.");
        }
        break;
      }
      case "keep":
        return {
          path: inspection.rootPath,
          sync: "reused"
        };
      case "cancel":
      default:
        throw new Error(`Checkout at ${inspection.rootPath} has local changes. Choose stash or keep.`);
    }
  }

  const fetchRun = await git(["-C", inspection.rootPath, "fetch", "--all", "--prune"]);
  if (fetchRun.exitCode !== 0) {
    throw new Error(fetchRun.stderr.trim() || "Git fetch failed.");
  }

  const checkoutRun = await git(["-C", inspection.rootPath, "checkout", input.branch]);
  if (checkoutRun.exitCode !== 0) {
    throw new Error(checkoutRun.stderr.trim() || `Unable to checkout ${input.branch}.`);
  }

  const pullRun = await git(["-C", inspection.rootPath, "pull", "--ff-only", "origin", input.branch]);
  if (pullRun.exitCode !== 0) {
    throw new Error(pullRun.stderr.trim() || "Git pull failed.");
  }

  return {
    path: inspection.rootPath,
    sync: "updated"
  };
}
