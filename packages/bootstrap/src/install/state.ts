import path from "node:path";

import { getLocalStateDir, nowIso, readJsonFile, writeJsonFileAtomic } from "../../../shared/src/index.js";

import type {
  BackgroundMode,
  BackgroundSetupResult,
  InstallDraftState,
  InstallResult,
  OwnedBackgroundArtifact
} from "./types.js";
import { DEFAULT_WINDOWS_DAEMON_TASK_NAME } from "./types.js";

function installDraftPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return path.join(getLocalStateDir(env, platform), "state", "install-draft.json");
}

function installStatePath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return path.join(getLocalStateDir(env, platform), "state", "install-last.json");
}

export interface PersistedInstallState extends InstallResult {
  generatedAt: string;
}

function normalizeComparePath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.win32.normalize(value).toLowerCase()
    : path.posix.normalize(value);
}

function backgroundModeOrFallback(value: string | undefined): BackgroundMode {
  return value === "launchagent"
    || value === "scheduled-task"
    || value === "startup"
    || value === "systemd-user"
    || value === "manual"
    || value === "skip"
    ? value
    : "manual";
}

function artifactKey(artifact: OwnedBackgroundArtifact, platform: NodeJS.Platform): string {
  if (artifact.kind === "scheduled-task") {
    return `${artifact.kind}:${(artifact.taskName ?? DEFAULT_WINDOWS_DAEMON_TASK_NAME).toLowerCase()}`;
  }

  return `${artifact.kind}:${normalizeComparePath(artifact.path ?? "", platform)}`;
}

export function normalizeOwnedBackgroundArtifacts(
  artifacts: readonly OwnedBackgroundArtifact[],
  platform: NodeJS.Platform = process.platform
): OwnedBackgroundArtifact[] {
  const seen = new Set<string>();
  const normalized: OwnedBackgroundArtifact[] = [];

  for (const artifact of artifacts) {
    if (artifact.kind === "scheduled-task") {
      const taskName = artifact.taskName?.trim() || DEFAULT_WINDOWS_DAEMON_TASK_NAME;
      const next: OwnedBackgroundArtifact = {
        kind: "scheduled-task",
        mode: artifact.mode,
        taskName
      };
      const key = artifactKey(next, platform);
      if (!seen.has(key)) {
        seen.add(key);
        normalized.push(next);
      }
      continue;
    }

    const normalizedPath = artifact.path?.trim();
    if (!normalizedPath) {
      continue;
    }

    const next: OwnedBackgroundArtifact = {
      kind: artifact.kind,
      mode: artifact.mode,
      path: normalizedPath
    };
    const key = artifactKey(next, platform);
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(next);
    }
  }

  return normalized;
}

export function ownedBackgroundArtifactsFromBackground(
  background: Pick<BackgroundSetupResult, "mode" | "artifactPath" | "launcherPath" | "ownedArtifacts"> | undefined,
  platform: NodeJS.Platform = process.platform
): OwnedBackgroundArtifact[] {
  if (!background) {
    return [];
  }

  if (Array.isArray(background.ownedArtifacts) && background.ownedArtifacts.length > 0) {
    return normalizeOwnedBackgroundArtifacts(background.ownedArtifacts, platform);
  }

  const mode = backgroundModeOrFallback(background.mode);
  const artifacts: OwnedBackgroundArtifact[] = [];

  if (background.launcherPath) {
    artifacts.push({
      kind: "launcher",
      mode,
      path: background.launcherPath
    });
  }

  if (mode === "launchagent" && background.artifactPath) {
    artifacts.push({
      kind: "launchagent",
      mode,
      path: background.artifactPath
    });
  }

  if (mode === "startup" && background.artifactPath) {
    artifacts.push({
      kind: "startup-shortcut",
      mode,
      path: background.artifactPath
    });
  }

  if (mode === "systemd-user" && background.artifactPath) {
    artifacts.push({
      kind: "systemd-user-unit",
      mode,
      path: background.artifactPath
    });
  }

  if (mode === "scheduled-task") {
    artifacts.push({
      kind: "scheduled-task",
      mode,
      taskName: DEFAULT_WINDOWS_DAEMON_TASK_NAME
    });
  }

  return normalizeOwnedBackgroundArtifacts(artifacts, platform);
}

export async function readInstallDraft(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<InstallDraftState | undefined> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const draft = await readJsonFile<InstallDraftState | undefined>(installDraftPath(env, platform), undefined);
  if (!draft || draft.version !== 1) {
    return undefined;
  }

  return draft;
}

export async function writeInstallDraft(input: {
  draft: Omit<InstallDraftState, "updatedAt"> & { updatedAt?: string };
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<InstallDraftState> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const next: InstallDraftState = {
    ...input.draft,
    version: 1,
    updatedAt: input.draft.updatedAt ?? nowIso()
  };
  await writeJsonFileAtomic(installDraftPath(env, platform), next);
  return next;
}

export async function readInstallState(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<PersistedInstallState | undefined> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const state = await readJsonFile<PersistedInstallState | undefined>(installStatePath(env, platform), undefined);
  if (!state || state.kind !== "install") {
    return undefined;
  }

  return {
    ...state,
    background: {
      ...state.background,
      ownedArtifacts: ownedBackgroundArtifactsFromBackground(state.background, platform)
    }
  };
}

export async function writeInstallState(input: {
  result: InstallResult;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<PersistedInstallState> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const previous = await readInstallState({
    env,
    platform
  });
  const background: BackgroundSetupResult = {
    ...input.result.background,
    ownedArtifacts: normalizeOwnedBackgroundArtifacts([
      ...ownedBackgroundArtifactsFromBackground(previous?.background, platform),
      ...ownedBackgroundArtifactsFromBackground(input.result.background, platform)
    ], platform)
  };
  const next: PersistedInstallState = {
    ...input.result,
    background,
    generatedAt: nowIso()
  };
  await writeJsonFileAtomic(installStatePath(env, platform), next);
  return next;
}
