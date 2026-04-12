import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { normalizeSpawnEnv, resolveExecutable } from "../../../shared/src/index.js";

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  binaryPath: string;
  shell: boolean;
  fallbackUsed: boolean;
}

interface ResolvedLaunchPlan {
  requestedCommand: string;
  command: string;
  commandArgs: string[];
  binaryPath: string;
  shell: boolean;
  fallbackUsed: boolean;
}

export class CommandExecutionError extends Error {
  readonly detail: {
    code?: string;
    failedCommand: string;
    failedBinary: string;
    binaryPath: string;
    likelyWindowsShim: boolean;
  };

  constructor(input: {
    code?: string;
    failedCommand: string;
    failedBinary: string;
    binaryPath: string;
    likelyWindowsShim: boolean;
    message: string;
  }) {
    super(input.message);
    this.name = "CommandExecutionError";
    this.detail = {
      code: input.code,
      failedCommand: input.failedCommand,
      failedBinary: input.failedBinary,
      binaryPath: input.binaryPath,
      likelyWindowsShim: input.likelyWindowsShim
    };
  }
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function stripWrappedQuotes(value: string): string {
  return value.trim().replace(/^"(.*)"$/u, "$1");
}

function quoteShellCommand(command: string): string {
  return `"${command}"`;
}

function isPathLike(command: string, platform: NodeJS.Platform): boolean {
  return path.isAbsolute(command)
    || (platform === "win32" && path.win32.isAbsolute(command))
    || command.includes("/")
    || command.includes("\\");
}

function hasWindowsShellExtension(command: string): boolean {
  return /\.(cmd|bat)$/iu.test(command);
}

async function isExecutableFile(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveWindowsCommandCompanion(command: string): Promise<string | undefined> {
  const requested = stripWrappedQuotes(command);
  if (path.extname(requested)) {
    return await isExecutableFile(requested, "win32") ? requested : undefined;
  }

  for (const extension of [".exe", ".cmd", ".bat", ".com"]) {
    const candidate = `${requested}${extension}`;
    if (await isExecutableFile(candidate, "win32")) {
      return candidate;
    }
  }

  return undefined;
}

async function resolveLaunchPlan(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  shell?: boolean;
  fallbackUsed?: boolean;
}): Promise<ResolvedLaunchPlan> {
  const requestedCommand = stripWrappedQuotes(input.command);

  if (isJavaScriptEntrypoint(requestedCommand)) {
    return {
      requestedCommand,
      command: process.execPath,
      commandArgs: [requestedCommand, ...input.args],
      binaryPath: process.execPath,
      shell: false,
      fallbackUsed: input.fallbackUsed ?? false
    };
  }

  let binaryPath = requestedCommand;
  let fallbackUsed = input.fallbackUsed ?? false;
  if (input.platform === "win32" && isPathLike(requestedCommand, input.platform)) {
    const companion = await resolveWindowsCommandCompanion(requestedCommand);
    if (companion) {
      binaryPath = companion;
      fallbackUsed = fallbackUsed || companion !== requestedCommand;
    }
  }

  const shell = input.shell ?? (input.platform === "win32" && hasWindowsShellExtension(binaryPath));
  return {
    requestedCommand,
    command: binaryPath,
    commandArgs: input.args,
    binaryPath,
    shell,
    fallbackUsed
  };
}

async function recoverLaunchPlan(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  shell?: boolean;
}, plan: ResolvedLaunchPlan, error: NodeJS.ErrnoException): Promise<ResolvedLaunchPlan | undefined> {
  if (input.platform !== "win32" || error.code !== "ENOENT") {
    return undefined;
  }

  const resolvedCommand = isPathLike(plan.requestedCommand, input.platform)
    ? await resolveWindowsCommandCompanion(plan.requestedCommand)
    : await resolveExecutable(plan.requestedCommand, {
      cwd: input.cwd,
      env: input.env,
      platform: input.platform
    });

  if (resolvedCommand && resolvedCommand !== plan.binaryPath) {
    return resolveLaunchPlan({
      ...input,
      command: resolvedCommand,
      fallbackUsed: true
    });
  }

  if (!plan.shell && hasWindowsShellExtension(plan.binaryPath)) {
    return {
      ...plan,
      shell: true,
      fallbackUsed: true
    };
  }

  return undefined;
}

function commandExecutionError(plan: ResolvedLaunchPlan, error: NodeJS.ErrnoException, platform: NodeJS.Platform): CommandExecutionError {
  const failedBinary = path.basename(plan.binaryPath, path.extname(plan.binaryPath)) || plan.requestedCommand;
  const likelyWindowsShim = platform === "win32" && error.code === "ENOENT"
    && (!path.extname(plan.binaryPath) || hasWindowsShellExtension(plan.binaryPath) || plan.binaryPath.toLowerCase().includes(`${path.sep}npm${path.sep}`));
  const message = likelyWindowsShim
    ? `${failedBinary} failed to start from ${plan.binaryPath}. This looks like a broken Windows shim or PATH issue. Open a new shell, verify the binary directly, or reinstall the tool, then rerun the installer.`
    : `${failedBinary} failed to start from ${plan.binaryPath}: ${error.message}`;

  return new CommandExecutionError({
    code: error.code,
    failedCommand: plan.requestedCommand,
    failedBinary,
    binaryPath: plan.binaryPath,
    likelyWindowsShim,
    message
  });
}

async function spawnCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: boolean;
}, fallbackUsed = false): Promise<CommandRunResult> {
  const args = input.args ?? [];
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const plan = await resolveLaunchPlan({
    command: input.command,
    args,
    cwd,
    env,
    platform,
    shell: input.shell,
    fallbackUsed
  });
  const spawnCommandValue = plan.shell ? quoteShellCommand(plan.command) : plan.command;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommandValue, plan.commandArgs, {
      cwd,
      env: normalizeSpawnEnv(env, platform),
      shell: plan.shell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", async (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }

      settled = true;
      const recovered = await recoverLaunchPlan({
        command: input.command,
        args,
        cwd,
        env,
        platform,
        shell: input.shell
      }, plan, error);
      if (recovered) {
        try {
          resolve(await spawnCommand({
            ...input,
            command: recovered.binaryPath,
            shell: recovered.shell
          }, true));
          return;
        } catch (retryError) {
          reject(retryError);
          return;
        }
      }

      reject(commandExecutionError(plan, error, platform));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        binaryPath: plan.binaryPath,
        shell: plan.shell,
        fallbackUsed: plan.fallbackUsed
      });
    });
  });
}

export async function runCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: boolean;
}): Promise<CommandRunResult> {
  return spawnCommand(input);
}

export async function runShellCommand(input: {
  commandLine: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<CommandRunResult> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  if (platform === "win32") {
    return runCommand({
      command: env.ComSpec ?? process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", input.commandLine],
      cwd: input.cwd,
      env,
      platform,
      shell: false
    });
  }

  return runCommand({
    command: env.SHELL ?? process.env.SHELL ?? "/bin/sh",
    args: ["-lc", input.commandLine],
    cwd: input.cwd,
    env,
    platform,
    shell: false
  });
}
