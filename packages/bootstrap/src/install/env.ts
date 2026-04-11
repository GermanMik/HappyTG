import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  getLocalStateDir,
  parseDotEnv,
  writeTextFileAtomic
} from "../../../shared/src/index.js";

import type { EnvWriteResult } from "./types.js";

function parseTemplateKeys(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
      return normalized.slice(0, normalized.indexOf("=")).trim();
    })
    .filter(Boolean);
}

function serializeEnvValue(value: string): string {
  if (!value) {
    return "";
  }

  return /^[A-Za-z0-9_./:@,-]*$/u.test(value)
    ? value
    : JSON.stringify(value);
}

export function mergeEnvTemplate(input: {
  templateText: string;
  existingText?: string;
  updates: Record<string, string | undefined>;
}): {
  content: string;
  addedKeys: string[];
  preservedKeys: string[];
} {
  const existing = input.existingText ? parseDotEnv(input.existingText) : {};
  const templateKeys = new Set(parseTemplateKeys(input.templateText));
  const addedKeys: string[] = [];
  const preservedKeys: string[] = [];
  const seenKeys = new Set<string>();
  const lines = input.templateText.split(/\r?\n/u).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    const key = normalized.slice(0, separator).trim();
    if (!key) {
      return line;
    }

    seenKeys.add(key);

    const nextValue = input.updates[key] ?? existing[key] ?? parseDotEnv(line)[key] ?? "";
    if (existing[key] !== undefined) {
      preservedKeys.push(key);
    } else if (nextValue !== "") {
      addedKeys.push(key);
    }

    return `${key}=${serializeEnvValue(nextValue)}`;
  });

  for (const [key, value] of Object.entries(existing)) {
    if (templateKeys.has(key) || seenKeys.has(key)) {
      continue;
    }

    lines.push(`${key}=${serializeEnvValue(value)}`);
    preservedKeys.push(key);
  }

  return {
    content: `${lines.join("\n").replace(/\n+$/u, "")}\n`,
    addedKeys: [...new Set(addedKeys)],
    preservedKeys: [...new Set(preservedKeys)]
  };
}

export async function writeMergedEnvFile(input: {
  repoRoot: string;
  updates: Record<string, string | undefined>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<EnvWriteResult> {
  const envFilePath = path.join(input.repoRoot, ".env");
  const envExamplePath = path.join(input.repoRoot, ".env.example");
  const templateText = await readFile(envExamplePath, "utf8");
  const existingText = await readFile(envFilePath, "utf8").catch(() => undefined);
  const merged = mergeEnvTemplate({
    templateText,
    existingText,
    updates: input.updates
  });

  let backupPath: string | undefined;
  const created = existingText === undefined;
  const changed = existingText !== merged.content;

  if (existingText !== undefined && changed) {
    const backupDir = path.join(getLocalStateDir(input.env, input.platform), "backups");
    await ensureDir(backupDir);
    backupPath = path.join(backupDir, `${path.basename(input.repoRoot)}-env-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`);
    await writeTextFileAtomic(backupPath, existingText);
  }

  if (changed) {
    await writeTextFileAtomic(envFilePath, merged.content);
  }

  return {
    envFilePath,
    created,
    changed,
    backupPath,
    addedKeys: merged.addedKeys,
    preservedKeys: merged.preservedKeys
  };
}

