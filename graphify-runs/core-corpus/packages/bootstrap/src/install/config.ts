import type { InstallerRepoSourceResolution } from "./types.js";
import { loadInstallerManifest } from "./manifest.js";

const DEFAULT_PRIMARY_REPO_URL = "https://github.com/GermanMik/HappyTG.git";

export function resolveInstallerRepoSources(input: {
  repoRoot?: string;
  requestedRepoUrl?: string;
}): InstallerRepoSourceResolution {
  const manifest = loadInstallerManifest(input.repoRoot);
  const manifestPrimary = manifest.repoSources.primary?.trim() || DEFAULT_PRIMARY_REPO_URL;
  const primaryUrl = input.requestedRepoUrl?.trim() || manifestPrimary;
  const fallbackUrl = manifest.repoSources.fallback?.trim();
  const primary = {
    id: "primary" as const,
    label: "primary source",
    url: primaryUrl
  };
  const fallback = fallbackUrl && fallbackUrl !== primaryUrl
    ? {
      id: "fallback" as const,
      label: "fallback source",
      url: fallbackUrl
    }
    : undefined;

  return {
    primary,
    fallback,
    sources: fallback ? [primary, fallback] : [primary]
  };
}
