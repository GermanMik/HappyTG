import { readFileSync } from "node:fs";
import path from "node:path";

export interface InstallerManifest {
  installers: Record<string, Record<string, string>>;
}

let cachedManifest: InstallerManifest | undefined;

function parseSimpleInstallerManifest(source: string): InstallerManifest {
  const installers: Record<string, Record<string, string>> = {};
  let currentInstaller = "";

  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */u)?.[0].length ?? 0;
    if (indent === 0) {
      continue;
    }

    if (indent === 2 && trimmed.endsWith(":")) {
      currentInstaller = trimmed.slice(0, -1).trim();
      installers[currentInstaller] = installers[currentInstaller] ?? {};
      continue;
    }

    if (indent === 4 && currentInstaller) {
      const separator = trimmed.indexOf(":");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      installers[currentInstaller][key] = value;
    }
  }

  return { installers };
}

export function loadInstallerManifest(repoRoot = process.cwd()): InstallerManifest {
  if (cachedManifest) {
    return cachedManifest;
  }

  const manifestPath = path.join(repoRoot, "packages", "bootstrap", "manifests", "installers", "installers.yaml");
  cachedManifest = parseSimpleInstallerManifest(readFileSync(manifestPath, "utf8"));
  return cachedManifest;
}

export function resolveInstallerInstruction(input: {
  manifest: InstallerManifest;
  dependencyId: string;
  candidates: string[];
}): {
  command?: string;
  manualInstruction?: string;
} {
  const entry = input.manifest.installers[input.dependencyId] ?? {};
  for (const candidate of input.candidates) {
    const value = entry[candidate];
    if (!value) {
      continue;
    }

    if (candidate.endsWith("-manual")) {
      return {
        manualInstruction: value
      };
    }

    return {
      command: value
    };
  }

  if (entry["all-manual"]) {
    return {
      manualInstruction: entry["all-manual"]
    };
  }

  if (entry.all) {
    return {
      command: entry.all
    };
  }

  return {};
}

