import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ActionKind, RuntimeExecutionResult, RuntimeReadiness, ToolCategory } from "../../protocol/src/index.js";
import { ensureDir, fileExists, normalizeSpawnEnv, nowIso, readTextFileOrEmpty, resolveExecutable, resolveHome } from "../../shared/src/index.js";

export * from "./codex-desktop.js";

export interface RuntimeAdapter {
  id: string;
  kind: "codex-cli" | "secondary";
  supportsProofLoop: boolean;
  supportsResumableSessions: boolean;
}

const DEFAULT_COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_GRACE_MS = 2_000;

class BoundedOutputBuffer {
  private readonly chunks: Buffer[] = [];
  private retainedBytes = 0;
  totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += buffer.byteLength;
    if (this.maxBytes <= 0) {
      return;
    }

    if (buffer.byteLength >= this.maxBytes) {
      this.chunks.length = 0;
      this.chunks.push(buffer.subarray(buffer.byteLength - this.maxBytes));
      this.retainedBytes = this.maxBytes;
      return;
    }

    this.chunks.push(buffer);
    this.retainedBytes += buffer.byteLength;

    while (this.retainedBytes > this.maxBytes && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      const overflow = this.retainedBytes - this.maxBytes;
      if (first.byteLength <= overflow) {
        this.chunks.shift();
        this.retainedBytes -= first.byteLength;
        continue;
      }

      this.chunks[0] = first.subarray(overflow);
      this.retainedBytes -= overflow;
    }
  }

  text(): string {
    return Buffer.concat(this.chunks, this.retainedBytes).toString("utf8");
  }

  truncated(): boolean {
    return this.totalBytes > this.retainedBytes;
  }
}

function outputMaxBytesFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES ?? env.HAPPYTG_CODEX_EXEC_OUTPUT_MAX_BYTES);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_COMMAND_OUTPUT_MAX_BYTES;
}

function timeoutGraceMsFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS ?? env.HAPPYTG_CODEX_EXEC_TIMEOUT_GRACE_MS);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_COMMAND_TIMEOUT_GRACE_MS;
}

export const primaryRuntimeAdapter: RuntimeAdapter = {
  id: "codex-cli",
  kind: "codex-cli",
  supportsProofLoop: true,
  supportsResumableSessions: true
};

export interface ToolExecutionCategoryPolicy {
  category: ToolCategory;
  defaultPolicy: "allow" | "require_approval" | "deny";
  approvalRequired: boolean;
  loggingRequired: boolean;
  evidenceRequired: boolean;
  executionLane: "parallel_read" | "serial_mutation";
}

export interface PlannedToolCall {
  id: string;
  actionKind: ActionKind;
}

export interface ToolExecutionBatch {
  mode: "parallel" | "serial";
  category: ToolCategory;
  calls: PlannedToolCall[];
}

const ACTION_TOOL_CATEGORIES: Readonly<Record<ActionKind, ToolCategory>> = {
  read_status: "safe_read",
  workspace_read: "safe_read",
  verification_run: "bounded_compute",
  session_resume: "bounded_compute",
  workspace_write: "repo_mutation",
  workspace_write_outside_root: "shell_network_system_sensitive",
  bootstrap_install: "shell_network_system_sensitive",
  bootstrap_config_edit: "shell_network_system_sensitive",
  daemon_pair: "shell_network_system_sensitive",
  git_push: "deploy_publish_external_side_effect",
  codex_desktop_resume: "shell_network_system_sensitive",
  codex_desktop_stop: "shell_network_system_sensitive",
  codex_desktop_new_task: "shell_network_system_sensitive"
};

export const TOOL_EXECUTION_CATEGORY_POLICIES: Readonly<Record<ToolCategory, ToolExecutionCategoryPolicy>> = {
  safe_read: {
    category: "safe_read",
    defaultPolicy: "allow",
    approvalRequired: false,
    loggingRequired: true,
    evidenceRequired: false,
    executionLane: "parallel_read"
  },
  bounded_compute: {
    category: "bounded_compute",
    defaultPolicy: "allow",
    approvalRequired: false,
    loggingRequired: true,
    evidenceRequired: true,
    executionLane: "parallel_read"
  },
  repo_mutation: {
    category: "repo_mutation",
    defaultPolicy: "require_approval",
    approvalRequired: true,
    loggingRequired: true,
    evidenceRequired: true,
    executionLane: "serial_mutation"
  },
  shell_network_system_sensitive: {
    category: "shell_network_system_sensitive",
    defaultPolicy: "require_approval",
    approvalRequired: true,
    loggingRequired: true,
    evidenceRequired: true,
    executionLane: "serial_mutation"
  },
  deploy_publish_external_side_effect: {
    category: "deploy_publish_external_side_effect",
    defaultPolicy: "deny",
    approvalRequired: true,
    loggingRequired: true,
    evidenceRequired: true,
    executionLane: "serial_mutation"
  }
};

export function classifyActionKind(actionKind: ActionKind): ToolCategory {
  return ACTION_TOOL_CATEGORIES[actionKind];
}

export function toolExecutionPolicyForAction(actionKind: ActionKind): ToolExecutionCategoryPolicy {
  return TOOL_EXECUTION_CATEGORY_POLICIES[classifyActionKind(actionKind)];
}

export function planToolExecutionBatches(calls: PlannedToolCall[]): ToolExecutionBatch[] {
  const batches: ToolExecutionBatch[] = [];
  let readBatch: ToolExecutionBatch | undefined;

  const flushReadBatch = () => {
    if (readBatch && readBatch.calls.length > 0) {
      batches.push(readBatch);
    }
    readBatch = undefined;
  };

  for (const call of calls) {
    const category = classifyActionKind(call.actionKind);
    const policy = TOOL_EXECUTION_CATEGORY_POLICIES[category];
    if (policy.executionLane === "parallel_read") {
      if (!readBatch) {
        readBatch = {
          mode: "parallel",
          category,
          calls: []
        };
      }
      readBatch.calls.push(call);
      continue;
    }

    flushReadBatch();
    batches.push({
      mode: "serial",
      category,
      calls: [call]
    });
  }

  flushReadBatch();
  return batches;
}

const BENIGN_CODEX_SMOKE_WARNING_PATTERNS = [
  /codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit/i,
  /codex_state::runtime: failed to remove legacy logs db file .* \(os error 32\)/i,
  /codex_state::runtime: failed to open state db .*migration .*missing in the resolved migrations/i,
  /codex_core::state_db: failed to initialize state runtime .*migration .*missing in the resolved migrations/i,
  /codex_rollout::state_db: failed to initialize state runtime .*migration .*missing in the resolved migrations/i,
  /codex_core::rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back/i,
  /codex_rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back/i,
  /codex_core::shell_snapshot: Failed to delete shell snapshot .*No such file or directory/i,
  /codex_core::shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell/i,
  /Reading additional input from stdin\.\.\./i
] as const;

function homeExpanded(configPath: string): string {
  return configPath.startsWith("~") ? resolveHome(configPath) : configPath;
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function quoteWindowsShellArg(value: string): string {
  if (!value) {
    return "\"\"";
  }

  if (!/[\s"&()<>^|%!]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/%/g, "%%").replace(/"/g, "\"\"")}"`;
}

function buildWindowsShellCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((value) => quoteWindowsShellArg(value))
    .join(" ");
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

export function summarizeCodexSmokeStderr(stderr: string): string | undefined {
  const actionableLines = classifyCodexSmokeStderr(stderr).actionableLines;
  const lines = actionableLines.length > 0
    ? actionableLines
    : stderr
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) {
    return undefined;
  }

  const timedOutMatch = stderr.match(/Process timed out after (\d+)ms\./iu);
  if (timedOutMatch) {
    return `Codex smoke command did not exit before the ${timedOutMatch[1]}ms timeout.`;
  }
  if (lines.some((line) => /unexpected argument .* found/iu.test(line))) {
    return lines.find((line) => /unexpected argument .* found/iu.test(line)) ?? firstLine;
  }
  const newerCodexLine = lines.find((line) => /requires a newer version of Codex/iu.test(line));
  if (newerCodexLine) {
    const modelMatch = newerCodexLine.match(/The '([^']+)' model requires a newer version of Codex/iu);
    return modelMatch
      ? `Codex CLI is too old for the configured ${modelMatch[1]} model. Upgrade Codex or select a model supported by this CLI.`
      : "Codex CLI is too old for the configured model. Upgrade Codex or select a model supported by this CLI.";
  }
  if (lines.some((line) => /responses_websocket: failed to connect to websocket: HTTP error: 403 Forbidden/iu.test(line)
      || /session_startup_prewarm: startup websocket prewarm setup failed: unexpected status 403 Forbidden/iu.test(line)
      || /unexpected status 403 Forbidden: .*wss:\/\/chatgpt\.com\/backend-api\/codex\/responses/iu.test(line))) {
    return lines.some((line) => /codex_core::client: falling back to http/iu.test(line))
      ? "Codex Responses websocket returned 403 Forbidden, then the CLI fell back to HTTP."
      : "Codex could not open the Responses websocket (403 Forbidden).";
  }
  if (lines.some((line) => /plugins::startup_sync: startup remote plugin sync failed/iu.test(line)
      || /plugins::manager: failed to warm featured plugin ids cache/iu.test(line))) {
    return "Codex could not sync plugins from chatgpt.com.";
  }
  if (lines.some((line) => /failed to open state db .*migration .*missing in the resolved migrations/iu.test(line))) {
    return "Codex state DB migrations are out of sync.";
  }

  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
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
    outputMaxBytes?: number;
    timeoutGraceMs?: number;
  }
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  outputRetentionBytes: number;
}> {
  const cwd = options?.cwd;
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const timeoutMs = options?.timeoutMs ?? Number(env.HAPPYTG_CODEX_EXEC_TIMEOUT_MS ?? 120_000);
  const outputRetentionBytes = options?.outputMaxBytes ?? outputMaxBytesFromEnv(env);
  const timeoutGraceMs = options?.timeoutGraceMs ?? timeoutGraceMsFromEnv(env);
  const invocation = await resolveCommandInvocation(command, args, {
    cwd,
    env,
    platform
  });
  const useWindowsShell = platform === "win32"
    && /\.(cmd|bat)$/i.test(invocation.command);
  const spawnEnv = normalizeSpawnEnv(env, platform);
  const spawnCommand = useWindowsShell
    ? buildWindowsShellCommand(invocation.command, invocation.args)
    : invocation.command;

  function forceKill(child: ChildProcess): void {
    if (!child.pid) {
      return;
    }

    if (platform === "win32") {
      const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore"
      });
      taskkill.on("error", () => undefined);
      return;
    }

    child.kill("SIGKILL");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, useWindowsShell ? [] : invocation.args, {
      cwd,
      env: spawnEnv,
      shell: useWindowsShell,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdout = new BoundedOutputBuffer(outputRetentionBytes);
    const stderr = new BoundedOutputBuffer(outputRetentionBytes);
    let timedOut = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const finish = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (graceTimer) {
        clearTimeout(graceTimer);
      }

      const timeoutSuffix = timedOut ? `Process timed out after ${timeoutMs}ms.` : "";
      const stderrText = [stderr.text(), timeoutSuffix].filter(Boolean).join("\n").trim();
      resolve({
        stdout: stdout.text(),
        stderr: stderrText,
        exitCode: timedOut ? 124 : code ?? 1,
        timedOut,
        stdoutBytes: stdout.totalBytes,
        stderrBytes: stderr.totalBytes + Buffer.byteLength(timeoutSuffix),
        stdoutTruncated: stdout.truncated(),
        stderrTruncated: stderr.truncated(),
        outputRetentionBytes
      });
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        forceKill(child);
        finish(124);
      }, timeoutGraceMs);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout.append(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr.append(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      reject(error);
    });
    child.on("close", (code) => {
      finish(code);
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
    let smokeTimedOut = false;
    let smokeOutput = "";
    let smokeError = "";

    if (available && configExists) {
      const smokeRun = await runCommand(commandPath, [...binaryArgs, "exec", "--skip-git-repo-check", "--json", smokePrompt], {
        cwd: input?.cwd,
        env,
        platform
      });
      smokeOk = smokeRun.exitCode === 0;
      smokeTimedOut = smokeRun.timedOut;
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
      smokeTimedOut,
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
      smokeTimedOut: false,
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
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      outputRetentionBytes: result.outputRetentionBytes,
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
