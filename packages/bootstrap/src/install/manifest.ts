import { readFileSync } from "node:fs";
import path from "node:path";

export interface InstallerManifest {
  installers: Record<string, Record<string, string>>;
  repoSources: Record<string, string>;
}

const cachedManifests = new Map<string, InstallerManifest>();

function parseSimpleInstallerManifest(source: string): InstallerManifest {
  const installers: Record<string, Record<string, string>> = {};
  const repoSources: Record<string, string> = {};
  let currentSection = "";
  let currentInstaller = "";

  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */u)?.[0].length ?? 0;
    if (indent === 0) {
      if (trimmed.endsWith(":")) {
        currentSection = trimmed.slice(0, -1).trim();
        currentInstaller = "";
      }
      continue;
    }

    if (currentSection === "installers" && indent === 2 && trimmed.endsWith(":")) {
      currentInstaller = trimmed.slice(0, -1).trim();
      installers[currentInstaller] = installers[currentInstaller] ?? {};
      continue;
    }

    if (currentSection === "installers" && indent === 4 && currentInstaller) {
      const separator = trimmed.indexOf(":");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      installers[currentInstaller][key] = value;
      continue;
    }

    if (currentSection === "repoSources" && indent === 2) {
      const separator = trimmed.indexOf(":");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      repoSources[key] = value;
    }
  }

  return { installers, repoSources };
}

export function loadInstallerManifest(repoRoot = process.cwd()): InstallerManifest {
  const manifestPath = path.join(repoRoot, "packages", "bootstrap", "manifests", "installers", "installers.yaml");
  const cachedManifest = cachedManifests.get(manifestPath);
  if (cachedManifest) {
    return cachedManifest;
  }

  const manifest = parseSimpleInstallerManifest(readFileSync(manifestPath, "utf8"));
  cachedManifests.set(manifestPath, manifest);
  return manifest;
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
