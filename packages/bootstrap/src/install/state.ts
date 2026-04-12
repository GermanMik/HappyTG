import path from "node:path";

import { getLocalStateDir, nowIso, readJsonFile, writeJsonFileAtomic } from "../../../shared/src/index.js";

import type { InstallDraftState } from "./types.js";

function installDraftPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return path.join(getLocalStateDir(env, platform), "state", "install-draft.json");
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
