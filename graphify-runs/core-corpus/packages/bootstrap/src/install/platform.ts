import os from "node:os";
import { readFile } from "node:fs/promises";

import { resolveExecutable } from "../../../shared/src/index.js";

import type { InstallerEnvironment, LinuxFamily, PlatformSnapshot, SystemPackageManager } from "./types.js";
import { loadInstallerManifest, resolveInstallerInstruction } from "./manifest.js";
import { runCommand } from "./commands.js";

function detectShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return env.ComSpec ?? "powershell";
  }

  return env.SHELL ?? "/bin/sh";
}

function majorVersion(version: string | undefined): number {
  if (!version) {
    return 0;
  }

  const match = version.trim().match(/v?(\d+)/u);
  return match ? Number(match[1]) : 0;
}

export async function detectLinuxFamily(platform: NodeJS.Platform, filePath = "/etc/os-release"): Promise<LinuxFamily> {
  if (platform !== "linux") {
    return "unknown";
  }

  try {
    const source = await readFile(filePath, "utf8");
    const normalized = source.toLowerCase();
    if (normalized.includes("id_like=debian") || normalized.includes("id=ubuntu") || normalized.includes("id=debian")) {
      return "debian";
    }
    if (normalized.includes("id_like=fedora") || normalized.includes("id=fedora")) {
      return "fedora";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

export async function detectSystemPackageManager(input: {
  platform: NodeJS.Platform;
  linuxFamily: LinuxFamily;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SystemPackageManager> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  if (input.platform === "darwin") {
    return (await resolveExecutable("brew", { cwd, env, platform: input.platform })) ? "brew" : "manual";
  }
  if (input.platform === "win32") {
    if (await resolveExecutable("winget", { cwd, env, platform: input.platform })) {
      return "winget";
    }
    if (await resolveExecutable("choco", { cwd, env, platform: input.platform })) {
      return "choco";
    }
    return "manual";
  }
  if (input.platform === "linux") {
    if (input.linuxFamily === "debian" && await resolveExecutable("apt-get", { cwd, env, platform: input.platform })) {
      return "apt-get";
    }
    if (input.linuxFamily === "fedora" && await resolveExecutable("dnf", { cwd, env, platform: input.platform })) {
      return "dnf";
    }
    if (await resolveExecutable("apt-get", { cwd, env, platform: input.platform })) {
      return "apt-get";
    }
    if (await resolveExecutable("dnf", { cwd, env, platform: input.platform })) {
      return "dnf";
    }
  }

  return "manual";
}

function installerCandidates(platform: PlatformSnapshot, dependencyId: string): string[] {
  const base: string[] = [];

  if (platform.platform === "darwin") {
    base.push(`darwin-${platform.systemPackageManager}`, "darwin");
  } else if (platform.platform === "win32") {
    base.push(`win32-${platform.systemPackageManager}`, "win32");
  } else {
    base.push(`linux-${platform.linuxFamily}`, "linux");
  }

  if (platform.platform === "win32" && platform.systemPackageManager !== "manual") {
    base.push("win32-manual");
  }
  if (platform.platform === "darwin") {
    base.push("darwin-manual");
  }
  if (platform.platform === "linux") {
    base.push(`linux-${platform.linuxFamily}-manual`, "linux-manual");
  }

  base.push(`${dependencyId}-manual`, "all-manual", "all");
  return base;
}

async function resolveVersion(command: string, args: string[], input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): Promise<string | undefined> {
  const binaryPath = await resolveExecutable(command, {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!binaryPath) {
    return undefined;
  }

  const result = await runCommand({
    command: binaryPath,
    args,
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);

  if (!result || result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim().split(/\r?\n/u)[0]?.trim() ?? undefined;
}

export async function detectPlatformSnapshot(input?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactiveTerminal?: boolean;
}): Promise<PlatformSnapshot> {
  const env = input?.env ?? process.env;
  const platform = input?.platform ?? process.platform;
  const linuxFamily = await detectLinuxFamily(platform);
  const systemPackageManager = await detectSystemPackageManager({
    platform,
    linuxFamily,
    cwd: input?.cwd,
    env
  });

  return {
    platform,
    arch: os.arch(),
    shell: detectShell(env, platform),
    linuxFamily,
    systemPackageManager,
    repoPackageManager: "pnpm",
    isInteractiveTerminal: input?.interactiveTerminal ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  };
}

export async function detectInstallerEnvironment(input?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactiveTerminal?: boolean;
  repoRoot?: string;
}): Promise<InstallerEnvironment> {
  const cwd = input?.cwd ?? process.cwd();
  const env = input?.env ?? process.env;
  const platform = await detectPlatformSnapshot(input);
  const manifest = loadInstallerManifest(input?.repoRoot ?? process.cwd());

  const gitPath = await resolveExecutable("git", { cwd, env, platform: platform.platform });
  const nodePath = await resolveExecutable("node", { cwd, env, platform: platform.platform });
  const pnpmPath = await resolveExecutable("pnpm", { cwd, env, platform: platform.platform });
  const codexPath = await resolveExecutable("codex", { cwd, env, platform: platform.platform });
  const dockerPath = await resolveExecutable("docker", { cwd, env, platform: platform.platform });

  const nodeVersion = nodePath
    ? await resolveVersion(nodePath, ["--version"], { cwd, env, platform: platform.platform })
    : undefined;
  const pnpmVersion = pnpmPath
    ? await resolveVersion(pnpmPath, ["--version"], { cwd, env, platform: platform.platform })
    : undefined;
  const gitVersion = gitPath
    ? await resolveVersion(gitPath, ["--version"], { cwd, env, platform: platform.platform })
    : undefined;
  const codexVersion = codexPath
    ? await resolveVersion(codexPath, ["--version"], { cwd, env, platform: platform.platform })
    : undefined;
  const dockerVersion = dockerPath
    ? await resolveVersion(dockerPath, ["--version"], { cwd, env, platform: platform.platform })
    : undefined;

  return {
    platform,
    dependencies: [
      {
        id: "git",
        label: "Git",
        available: Boolean(gitPath),
        required: true,
        version: gitVersion,
        binaryPath: gitPath,
        ...resolveInstallerInstruction({
          manifest,
          dependencyId: "git",
          candidates: installerCandidates(platform, "git")
        })
      },
      {
        id: "nodejs",
        label: "Node.js 22+",
        available: Boolean(nodePath) && majorVersion(nodeVersion) >= 22,
        required: true,
        version: nodeVersion,
        binaryPath: nodePath,
        reason: nodePath && majorVersion(nodeVersion) < 22 ? `Found ${nodeVersion ?? "an unknown Node.js version"}, but HappyTG requires Node.js 22+.` : undefined,
        ...resolveInstallerInstruction({
          manifest,
          dependencyId: "nodejs",
          candidates: installerCandidates(platform, "nodejs")
        })
      },
      {
        id: "pnpm",
        label: "pnpm",
        available: Boolean(pnpmPath),
        required: true,
        version: pnpmVersion,
        binaryPath: pnpmPath,
        ...resolveInstallerInstruction({
          manifest,
          dependencyId: "pnpm",
          candidates: installerCandidates(platform, "pnpm")
        })
      },
      {
        id: "codex-cli",
        label: "Codex CLI",
        available: Boolean(codexPath),
        required: true,
        version: codexVersion,
        binaryPath: codexPath,
        ...resolveInstallerInstruction({
          manifest,
          dependencyId: "codex-cli",
          candidates: installerCandidates(platform, "codex-cli")
        })
      },
      {
        id: "docker",
        label: platform.platform === "darwin" || platform.platform === "win32" ? "Docker Desktop" : "Docker",
        available: Boolean(dockerPath),
        required: false,
        version: dockerVersion,
        binaryPath: dockerPath,
        reason: "Optional for the packaged/local infra path.",
        ...resolveInstallerInstruction({
          manifest,
          dependencyId: "docker",
          candidates: installerCandidates(platform, "docker")
        })
      }
    ]
  };
}

