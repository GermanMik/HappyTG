import { spawn } from "node:child_process";
import path from "node:path";

import { normalizeSpawnEnv } from "../../../shared/src/index.js";

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function quoteShellCommand(command: string): string {
  return `"${command}"`;
}

export async function runCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: boolean;
}): Promise<CommandRunResult> {
  const args = input.args ?? [];
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const useShell = input.shell ?? (platform === "win32" && /\.(cmd|bat)$/i.test(input.command));
  const command = isJavaScriptEntrypoint(input.command) ? process.execPath : input.command;
  const commandArgs = isJavaScriptEntrypoint(input.command) ? [input.command, ...args] : args;
  const spawnCommand = useShell ? quoteShellCommand(command) : command;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, commandArgs, {
      cwd,
      env: normalizeSpawnEnv(env, platform),
      shell: useShell
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });
  });
}

export async function runShellCommand(input: {
  commandLine: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<CommandRunResult> {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") {
    return runCommand({
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", input.commandLine],
      cwd: input.cwd,
      env: input.env,
      platform,
      shell: false
    });
  }

  return runCommand({
    command: process.env.SHELL ?? "/bin/sh",
    args: ["-lc", input.commandLine],
    cwd: input.cwd,
    env: input.env,
    platform,
    shell: false
  });
}
