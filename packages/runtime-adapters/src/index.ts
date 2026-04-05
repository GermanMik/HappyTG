import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RuntimeExecutionResult, RuntimeReadiness } from "../../protocol/src/index.js";
import { ensureDir, fileExists, nowIso, readTextFileOrEmpty, resolveHome } from "../../shared/src/index.js";

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

function homeExpanded(configPath: string): string {
  return configPath.startsWith("~") ? resolveHome(configPath) : configPath;
}

async function runCommand(command: string, args: string[], cwd?: string, timeoutMs = Number(process.env.HAPPYTG_CODEX_EXEC_TIMEOUT_MS ?? 120_000)): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
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
  configPath?: string;
  smokePrompt?: string;
}): Promise<RuntimeReadiness> {
  const binaryPath = input?.binaryPath ?? process.env.CODEX_CLI_BIN ?? "codex";
  const configPath = homeExpanded(input?.configPath ?? process.env.CODEX_CONFIG_PATH ?? "~/.codex/config.toml");
  const smokePrompt = input?.smokePrompt ?? process.env.CODEX_SMOKE_PROMPT ?? "Print exactly OK and exit.";
  const configExists = await fileExists(configPath);

  try {
    const versionRun = await runCommand(binaryPath, ["--version"]);
    const available = versionRun.exitCode === 0;
    let smokeOk = false;
    let smokeOutput = "";
    let smokeError = "";

    if (available && configExists) {
      const smokeRun = await runCommand(binaryPath, ["exec", "--skip-git-repo-check", "--json", smokePrompt]);
      smokeOk = smokeRun.exitCode === 0;
      smokeOutput = smokeRun.stdout.trim();
      smokeError = smokeRun.stderr.trim();
    }

    return {
      runtime: "codex-cli",
      available,
      binaryPath,
      version: versionRun.stdout.trim() || versionRun.stderr.trim(),
      configPath,
      configExists,
      smokeOk,
      smokeOutput,
      smokeError
    };
  } catch (error) {
    return {
      runtime: "codex-cli",
      available: false,
      binaryPath,
      configPath,
      configExists,
      smokeOk: false,
      smokeError: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function runCodexExec(input: {
  cwd: string;
  prompt: string;
  outputDir?: string;
  profile?: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  skipGitRepoCheck?: boolean;
  extraArgs?: string[];
  timeoutMs?: number;
}): Promise<RuntimeExecutionResult> {
  const startedAt = nowIso();
  const binaryPath = process.env.CODEX_CLI_BIN ?? "codex";
  const outputDir = input.outputDir ?? path.join(os.tmpdir(), "happytg-codex");
  await ensureDir(outputDir);

  const lastMessagePath = path.join(outputDir, `codex-last-message-${Date.now()}.txt`);
  const args = ["exec", "--json", "-o", lastMessagePath, "-C", input.cwd];
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

  const result = await runCommand(binaryPath, args, input.cwd, input.timeoutMs);
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
}

export async function writeSessionCheckpoint(filePath: string, payload: Record<string, unknown>): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
