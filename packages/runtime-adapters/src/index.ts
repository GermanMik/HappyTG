import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RuntimeExecutionResult, RuntimeReadiness } from "../../protocol/src/index.js";
import { ensureDir, fileExists, normalizeSpawnEnv, nowIso, readTextFileOrEmpty, resolveExecutable, resolveHome } from "../../shared/src/index.js";

export interface RuntimeAdapter {
  id: string;
  kind: "codex-cli" | "secondary";
  supportsProofLoop: boolean;
  supportsResumableSessions: boolean;
}

export const primaryRuntimeAdapter: RuntimeAdapter = {
  id: "codex-cli",
  kind: "codex-cli",
  supportsProofLoop: true,
  supportsResumableSessions: true
};

const BENIGN_CODEX_SMOKE_WARNING_PATTERNS = [
  /codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit/i,
  /codex_state::runtime: failed to open state db .*migration .*missing in the resolved migrations/i,
  /codex_core::state_db: failed to initialize state runtime .*migration .*missing in the resolved migrations/i,
  /codex_core::rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back/i,
  /codex_core::shell_snapshot: Failed to delete shell snapshot .*No such file or directory/i
] as const;

function homeExpanded(configPath: string): string {
  return configPath.startsWith("~") ? resolveHome(configPath) : configPath;
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function quoteShellCommand(command: string): string {
  return `"${command}"`;
}

function formatSpawnError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isCommandMissingError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function codexCliMissingMessage(): string {
  return "Codex CLI is not on the current shell PATH yet. Check the global npm prefix and installed Codex wrapper files to see whether this is a PATH issue or a partial install. If Codex is still missing, reinstall Codex, update PATH, verify `codex --version`, then run `pnpm happytg doctor`.";
}

export function classifyCodexSmokeStderr(stderr: string): {
  actionableLines: string[];
  ignoredLines: string[];
} {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const actionableLines: string[] = [];
  const ignoredLines: string[] = [];
  for (const line of lines) {
    if (BENIGN_CODEX_SMOKE_WARNING_PATTERNS.some((pattern) => pattern.test(line))) {
      ignoredLines.push(line);
      continue;
    }

    actionableLines.push(line);
  }

  return {
    actionableLines,
    ignoredLines
  };
}

async function resolveCommandInvocation(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }
) : Promise<{ command: string; args: string[]; resolvedPath?: string }> {
  const resolvedPath = await resolveExecutable(command, {
    cwd: options?.cwd,
    env: options?.env,
    platform: options?.platform
  });
  const commandPath = resolvedPath ?? command;

  if (isJavaScriptEntrypoint(commandPath)) {
    return {
      command: process.execPath,
      args: [commandPath, ...args],
      resolvedPath
    };
  }

  return {
    command: commandPath,
    args,
    resolvedPath
  };
}

async function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const cwd = options?.cwd;
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const timeoutMs = options?.timeoutMs ?? Number(env.HAPPYTG_CODEX_EXEC_TIMEOUT_MS ?? 120_000);
  const invocation = await resolveCommandInvocation(command, args, {
    cwd,
    env,
    platform
  });
  const useWindowsShell = platform === "win32"
    && /\.(cmd|bat)$/i.test(invocation.command);
  const spawnEnv = normalizeSpawnEnv(env, platform);
  const spawnCommand = useWindowsShell
    ? quoteShellCommand(invocation.command)
    : invocation.command;
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, invocation.args, {
      cwd,
      env: spawnEnv,
      shell: useWindowsShell
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? `${stderr}\nProcess timed out after ${timeoutMs}ms.`.trim() : stderr,
        exitCode: timedOut ? 124 : code ?? 1,
        timedOut
      });
    });
  });
}

export async function checkCodexReadiness(input?: {
  binaryPath?: string;
  binaryArgs?: string[];
  configPath?: string;
  smokePrompt?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<RuntimeReadiness> {
  const env = input?.env ?? process.env;
  const platform = input?.platform ?? process.platform;
  const binaryPath = input?.binaryPath ?? env.CODEX_CLI_BIN ?? "codex";
  const binaryArgs = input?.binaryArgs ?? [];
  const configPath = homeExpanded(input?.configPath ?? env.CODEX_CONFIG_PATH ?? "~/.codex/config.toml");
  const smokePrompt = input?.smokePrompt ?? env.CODEX_SMOKE_PROMPT ?? "Print exactly OK and exit.";
  const configExists = await fileExists(configPath);
  const resolvedBinaryPath = await resolveExecutable(binaryPath, {
    cwd: input?.cwd,
    env,
    platform
  });
  const commandPath = resolvedBinaryPath ?? binaryPath;

  try {
    const versionRun = await runCommand(commandPath, [...binaryArgs, "--version"], {
      cwd: input?.cwd,
      env,
      platform
    });
    const available = versionRun.exitCode === 0;
    let smokeOk = false;
    let smokeOutput = "";
    let smokeError = "";

    if (available && configExists) {
      const smokeRun = await runCommand(commandPath, [...binaryArgs, "exec", "--skip-git-repo-check", "--json", smokePrompt], {
        cwd: input?.cwd,
        env,
        platform
      });
      smokeOk = smokeRun.exitCode === 0;
      smokeOutput = smokeRun.stdout.trim();
      smokeError = smokeRun.stderr.trim();
    }

    return {
      runtime: "codex-cli",
      available,
      missing: false,
      binaryPath: commandPath,
      version: versionRun.stdout.trim() || versionRun.stderr.trim(),
      configPath,
      configExists,
      smokeOk,
      smokeOutput,
      smokeError
    };
  } catch (error) {
    const missing = isCommandMissingError(error);
    return {
      runtime: "codex-cli",
      available: false,
      missing,
      binaryPath: commandPath,
      configPath,
      configExists,
      smokeOk: false,
      smokeError: missing ? codexCliMissingMessage() : formatSpawnError(error)
    };
  }
}

export async function runCodexExec(input: {
  cwd: string;
  prompt: string;
  binaryPath?: string;
  binaryArgs?: string[];
  outputDir?: string;
  profile?: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  skipGitRepoCheck?: boolean;
  extraArgs?: string[];
  timeoutMs?: number;
}): Promise<RuntimeExecutionResult> {
  const startedAt = nowIso();
  const binaryPath = input.binaryPath ?? process.env.CODEX_CLI_BIN ?? "codex";
  const binaryArgs = input.binaryArgs ?? [];
  const outputDir = input.outputDir ?? path.join(os.tmpdir(), "happytg-codex");
  await ensureDir(outputDir);

  const lastMessagePath = path.join(outputDir, `codex-last-message-${Date.now()}.txt`);
  const args = [...binaryArgs, "exec", "--json", "-o", lastMessagePath, "-C", input.cwd];
  if (input.sandbox) {
    args.push("--sandbox", input.sandbox);
  }
  if (input.profile) {
    args.push("--profile", input.profile);
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.skipGitRepoCheck ?? true) {
    args.push("--skip-git-repo-check");
  }
  if (input.extraArgs) {
    args.push(...input.extraArgs);
  }
  args.push(input.prompt);

  try {
    const result = await runCommand(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs
    });
    const finishedAt = nowIso();
    const lastMessage = await readTextFileOrEmpty(lastMessagePath);

    return {
      ok: result.exitCode === 0,
      timedOut: result.timedOut,
      summary: result.timedOut
        ? `Codex execution timed out after ${input.timeoutMs ?? Number(process.env.HAPPYTG_CODEX_EXEC_TIMEOUT_MS ?? 120_000)}ms.`
        : lastMessage.trim() || result.stdout.trim().split("\n").slice(-5).join("\n") || "Codex run completed",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      startedAt,
      finishedAt,
      lastMessagePath
    };
  } catch (error) {
    return {
      ok: false,
      timedOut: false,
      summary: isCommandMissingError(error) ? codexCliMissingMessage() : "Codex execution failed. Run `pnpm happytg doctor --json` for details.",
      stdout: "",
      stderr: formatSpawnError(error),
      exitCode: isCommandMissingError(error) ? 127 : 1,
      startedAt,
      finishedAt: nowIso(),
      lastMessagePath
    };
  }
}

export async function writeSessionCheckpoint(filePath: string, payload: Record<string, unknown>): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
