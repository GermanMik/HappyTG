import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { BootstrapFinding, BootstrapReport, RuntimeReadiness } from "../../protocol/src/index.js";
import { checkCodexReadiness, classifyCodexSmokeStderr, codexCliMissingMessage } from "../../runtime-adapters/src/index.js";
import {
  createId,
  ensureDir,
  fileExists,
  findUpwardFile,
  getLocalStateDir,
  normalizeSpawnEnv,
  nowIso,
  readPort,
  resolveExecutable,
  telegramTokenStatus,
  writeJsonFileAtomic
} from "../../shared/src/index.js";

export type BootstrapCommand = "doctor" | "setup" | "repair" | "verify" | "status" | "config-init" | "env-snapshot";

interface DoctorContext {
  command: BootstrapCommand;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface DoctorDetection {
  findings: BootstrapFinding[];
  planPreview: string[];
  profileRecommendation: BootstrapReport["profileRecommendation"];
  reportJson: Record<string, unknown>;
}

interface PortCheckDefinition {
  id: string;
  label: string;
  envKeys: string[];
  defaultPort: number;
  command?: string;
  overrideEnv?: string;
  expectedService?: string;
  probe: "http" | "redis" | "tcp";
}

type PortCheckState = "free" | "occupied_expected" | "occupied_external";

interface PortCheckResult {
  id: string;
  label: string;
  port: number;
  probe: PortCheckDefinition["probe"];
  state: PortCheckState;
  detail: string;
  overrideEnv?: string;
  command?: string;
  service?: string;
}

type RedisState = "absent" | "installed_stopped" | "running" | "port_conflict" | "remote";

interface RedisDetection {
  state: RedisState;
  url: string;
  host: string;
  port: number;
  local: boolean;
  installed: boolean;
  detail: string;
  executablePaths: {
    redisCli: string | null;
    redisServer: string | null;
  };
}

interface CodexInstallCheck {
  npmBinaryPath: string | null;
  npmPrefix: string | null;
  npmBinDir: string | null;
  detectedBinDir: string | null;
  prefixChecked: boolean;
  wrapperCandidates: string[];
  wrapperPaths: string[];
  pathLikelyIssue: boolean;
}

interface CodexReadinessResolution {
  direct: RuntimeReadiness;
  effective: RuntimeReadiness;
  installCheck?: CodexInstallCheck;
  pathPending: boolean;
  wrapperPath?: string;
}

const criticalPortDefinitions: PortCheckDefinition[] = [
  {
    id: "miniapp",
    label: "Mini App",
    envKeys: ["HAPPYTG_MINIAPP_PORT"],
    defaultPort: 3001,
    probe: "http",
    expectedService: "miniapp",
    command: "pnpm dev:miniapp",
    overrideEnv: "HAPPYTG_MINIAPP_PORT"
  },
  {
    id: "api",
    label: "API",
    envKeys: ["HAPPYTG_API_PORT"],
    defaultPort: 4000,
    probe: "http",
    expectedService: "api",
    command: "pnpm dev:api",
    overrideEnv: "HAPPYTG_API_PORT"
  },
  {
    id: "bot",
    label: "Bot",
    envKeys: ["HAPPYTG_BOT_PORT"],
    defaultPort: 4100,
    probe: "http",
    expectedService: "bot",
    command: "pnpm dev:bot",
    overrideEnv: "HAPPYTG_BOT_PORT"
  },
  {
    id: "worker",
    label: "Worker probe",
    envKeys: ["HAPPYTG_WORKER_PORT"],
    defaultPort: 4200,
    probe: "http",
    expectedService: "worker",
    command: "pnpm dev:worker",
    overrideEnv: "HAPPYTG_WORKER_PORT"
  },
  {
    id: "redis",
    label: "Redis host port",
    envKeys: ["HAPPYTG_REDIS_HOST_PORT"],
    defaultPort: 6379,
    probe: "redis",
    overrideEnv: "HAPPYTG_REDIS_HOST_PORT"
  },
  {
    id: "postgres",
    label: "Postgres host port",
    envKeys: [],
    defaultPort: 5432,
    probe: "tcp"
  },
  {
    id: "minio-api",
    label: "MinIO API host port",
    envKeys: [],
    defaultPort: 9000,
    probe: "tcp"
  },
  {
    id: "minio-console",
    label: "MinIO console host port",
    envKeys: [],
    defaultPort: 9001,
    probe: "tcp"
  }
] as const;

function pushPlanStep(planPreview: string[], step: string): void {
  if (!planPreview.includes(step)) {
    planPreview.push(step);
  }
}

function pushFinding(findings: BootstrapFinding[], finding: BootstrapFinding): void {
  if (!findings.some((item) => item.code === finding.code && item.message === finding.message)) {
    findings.push(finding);
  }
}

function platformCommands(platform: NodeJS.Platform = process.platform): {
  copyEnv: string;
  inlineEnvExample: (key: string, value: string | number, command: string) => string;
} {
  if (platform === "win32") {
    return {
      copyEnv: "Copy-Item .env.example .env",
      inlineEnvExample: (key, value, command) => `$env:${key}=${JSON.stringify(String(value))}; ${command}`
    };
  }

  return {
    copyEnv: "cp .env.example .env",
    inlineEnvExample: (key, value, command) => `${key}=${value} ${command}`
  };
}

function telegramBotTarget(env: NodeJS.ProcessEnv): string {
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "");
  return username ? `@${username}` : "Telegram";
}

function defaultInfraComposeCommand(redis: RedisDetection, platform: NodeJS.Platform): string {
  const services = redis.state === "running" ? "postgres minio" : "postgres redis minio";
  const command = `docker compose -f infra/docker-compose.example.yml up ${services}`;

  if (platform === "win32") {
    return command;
  }

  return command;
}

function formatCodexSummary(version: string | undefined): string {
  if (!version) {
    return "not found";
  }

  return version.split("\n")[0]?.trim() ?? "available";
}

function formatCodexPreflightSummary(input: {
  pathPending?: boolean;
  available: boolean;
  missing?: boolean;
  version?: string;
}): string {
  if (input.available) {
    return input.pathPending
      ? `${formatCodexSummary(input.version)} (via npm wrapper; PATH follow-up still needed)`
      : formatCodexSummary(input.version);
  }

  if (input.missing === false) {
    return "detected but unavailable";
  }

  return "not found";
}

function codexUnavailableMessage(): string {
  return "Codex CLI was found, but `codex --version` did not complete successfully. Fix the local Codex install or shell environment, then rerun `pnpm happytg doctor --json`.";
}

function codexMissingMessage(installCheck?: CodexInstallCheck): string {
  if (installCheck?.pathLikelyIssue) {
    const detectedBinDir = installCheck.detectedBinDir;
    if (!installCheck.prefixChecked) {
      return detectedBinDir
        ? `Codex CLI is not on the current shell PATH yet. HappyTG found Codex wrapper files under \`${detectedBinDir}\`, so this looks like a PATH issue. Update PATH, restart the shell, verify \`codex --version\`, then run \`pnpm happytg doctor\`.`
        : "Codex CLI is not on the current shell PATH yet. HappyTG found Codex wrapper files in a likely Windows npm bin location, so this looks like a PATH issue. Update PATH, restart the shell, verify `codex --version`, then run `pnpm happytg doctor`.";
    }

    return detectedBinDir
      ? `Codex CLI is not on the current shell PATH yet. HappyTG found Codex wrapper files under \`${detectedBinDir}\`, so this looks like a PATH issue. Update PATH, restart the shell, verify \`codex --version\`, then run \`pnpm happytg doctor\`.`
      : "Codex CLI is not on the current shell PATH yet. HappyTG found Codex wrapper files under the global npm prefix, so this looks like a PATH issue. Update PATH, restart the shell, verify `codex --version`, then run `pnpm happytg doctor`.";
  }

  if (installCheck?.prefixChecked) {
    return "Codex CLI is not on the current shell PATH yet. HappyTG checked the global npm prefix and did not find Codex wrapper files, so this looks like a missing or partial install. Reinstall Codex, update PATH, verify `codex --version`, then run `pnpm happytg doctor`.";
  }

  return codexCliMissingMessage();
}

function likelyWindowsNpmBinDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = new Set<string>();
  const appData = env.APPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();
  const home = env.HOME?.trim();

  if (appData) {
    dirs.add(path.join(appData, "npm"));
  }
  if (userProfile) {
    dirs.add(path.join(userProfile, "AppData", "Roaming", "npm"));
  }
  if (home) {
    dirs.add(path.join(home, "AppData", "Roaming", "npm"));
  }

  return [...dirs].filter(Boolean);
}

function detectedCodexBinDir(installCheck?: CodexInstallCheck): string | null {
  if (!installCheck) {
    return null;
  }

  return installCheck.detectedBinDir
    ?? installCheck.npmBinDir
    ?? (installCheck.wrapperPaths[0] ? path.dirname(installCheck.wrapperPaths[0]) : null);
}

function formatPortStateForSummary(results: PortCheckResult[]): string {
  const relevant = results.filter((item) => ["miniapp", "api", "bot", "worker", "redis"].includes(item.id));
  const busy = relevant.filter((item) => item.state !== "free");
  if (busy.length === 0) {
    return "all critical ports free";
  }

  const busyDescriptions = busy.map((item) => `${item.port} ${item.state === "occupied_expected" ? "busy (HappyTG)" : "busy"}`);
  return `${busyDescriptions.join(", ")}; others free`;
}

function envPresenceSummary(envFilePath: string | undefined): string {
  return envFilePath ? `.env found` : `.env missing`;
}

function redisSummary(redis: RedisDetection): string {
  switch (redis.state) {
    case "running":
      return `running on ${redis.host}:${redis.port}`;
    case "installed_stopped":
      return `installed but not running on ${redis.host}:${redis.port}`;
    case "absent":
      return `not detected on ${redis.host}:${redis.port}`;
    case "port_conflict":
      return `port ${redis.port} is occupied by a non-Redis process`;
    case "remote":
      return `remote URL ${redis.url}`;
    default:
      return redis.detail;
  }
}

function isLocalRedisHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", ""].includes(host);
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function npmBinDirForPrefix(prefix: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? prefix : path.join(prefix, "bin");
}

async function runResolvedToolCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number } | undefined> {
  const resolvedPath = await resolveExecutable(input.command, {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!resolvedPath) {
    return undefined;
  }

  const command = isJavaScriptEntrypoint(resolvedPath) ? process.execPath : resolvedPath;
  const args = isJavaScriptEntrypoint(resolvedPath) ? [resolvedPath, ...input.args] : input.args;
  const useShell = input.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedPath);
  const timeoutMs = input.timeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: input.cwd,
      env: normalizeSpawnEnv(input.env, input.platform),
      shell: useShell
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
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
        stderr,
        exitCode: code ?? 1
      });
    });
  });
}

async function detectCodexInstallCheck(
  env: NodeJS.ProcessEnv,
  options: {
    cwd: string;
    platform: NodeJS.Platform;
  }
): Promise<CodexInstallCheck> {
  const npmRun = await runResolvedToolCommand({
    command: "npm",
    args: ["prefix", "-g"],
    cwd: options.cwd,
    env,
    platform: options.platform
  }).catch(() => undefined);
  const npmBinaryPath = await resolveExecutable("npm", {
    cwd: options.cwd,
    env,
    platform: options.platform
  });
  const npmPrefix = npmRun?.exitCode === 0 ? npmRun.stdout.trim().split(/\r?\n/u)[0]?.trim() ?? "" : "";
  const npmBinDir = npmPrefix ? npmBinDirForPrefix(npmPrefix, options.platform) : "";
  const candidateSet = new Set<string>();

  if (npmPrefix) {
    candidateSet.add(path.join(npmPrefix, "codex"));
    candidateSet.add(path.join(npmPrefix, "codex.cmd"));
    candidateSet.add(path.join(npmPrefix, "codex.ps1"));
  }
  if (npmBinDir) {
    candidateSet.add(path.join(npmBinDir, "codex"));
    candidateSet.add(path.join(npmBinDir, "codex.cmd"));
    candidateSet.add(path.join(npmBinDir, "codex.ps1"));
  }
  if (options.platform === "win32") {
    for (const dir of likelyWindowsNpmBinDirs(env)) {
      candidateSet.add(path.join(dir, "codex"));
      candidateSet.add(path.join(dir, "codex.cmd"));
      candidateSet.add(path.join(dir, "codex.ps1"));
    }
  }

  const wrapperCandidates = [...candidateSet];
  const wrapperChecks = await Promise.all(wrapperCandidates.map(async (candidate) => ({
    candidate,
    exists: await fileExists(candidate)
  })));
  const wrapperPaths = wrapperChecks.filter((entry) => entry.exists).map((entry) => entry.candidate);
  const detectedBinDir = npmBinDir || (wrapperPaths[0] ? path.dirname(wrapperPaths[0]) : null);

  return {
    npmBinaryPath: npmBinaryPath ?? null,
    npmPrefix: npmPrefix || null,
    npmBinDir: npmBinDir || null,
    detectedBinDir,
    prefixChecked: Boolean(npmBinaryPath && npmRun?.exitCode === 0 && npmPrefix),
    wrapperCandidates,
    wrapperPaths,
    pathLikelyIssue: wrapperPaths.length > 0
  };
}

async function resolveCodexReadiness(context: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): Promise<CodexReadinessResolution> {
  const direct = await checkCodexReadiness({
    cwd: context.cwd,
    env: context.env,
    platform: context.platform
  });
  if (direct.available || direct.missing === false) {
    return {
      direct,
      effective: direct,
      pathPending: false
    };
  }

  const installCheck = await detectCodexInstallCheck(context.env, {
    cwd: context.cwd,
    platform: context.platform
  });
  if (!installCheck.pathLikelyIssue) {
    return {
      direct,
      effective: direct,
      installCheck,
      pathPending: false
    };
  }

  for (const wrapperPath of installCheck.wrapperPaths) {
    const resolved = await checkCodexReadiness({
      cwd: context.cwd,
      env: context.env,
      platform: context.platform,
      binaryPath: wrapperPath
    });
    if (resolved.available || resolved.missing === false) {
      return {
        direct,
        effective: resolved,
        installCheck,
        pathPending: resolved.available,
        wrapperPath
      };
    }
  }

  return {
    direct,
    effective: direct,
    installCheck,
    pathPending: false
  };
}

function safeUrlPort(url: URL, fallback: number): number {
  if (!url.port) {
    return fallback;
  }

  const parsed = Number(url.port);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function canConnect(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host,
      port
    });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function detectHappyTGServiceOnPort(port: number): Promise<string | undefined> {
  const urls = [
    `http://127.0.0.1:${port}/ready`,
    `http://127.0.0.1:${port}/health`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(750)
      });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        continue;
      }

      const body = await response.json() as { service?: string };
      if (body.service) {
        return body.service;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function probeRedis(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host,
      port
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    socket.on("data", (chunk) => {
      finish(chunk.toString("utf8").includes("PONG"));
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function detectPortCheck(definition: PortCheckDefinition, env: NodeJS.ProcessEnv): Promise<PortCheckResult> {
  const port = definition.envKeys.length > 0
    ? readPort(env, definition.envKeys, definition.defaultPort)
    : definition.defaultPort;
  const connected = await canConnect("127.0.0.1", port);
  if (!connected) {
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: "free",
      detail: `${definition.label} port ${port} is free.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command
    };
  }

  if (definition.probe === "http") {
    const service = await detectHappyTGServiceOnPort(port);
    if (service && service === definition.expectedService) {
      return {
        id: definition.id,
        label: definition.label,
        port,
        probe: definition.probe,
        state: "occupied_expected",
        detail: `${definition.label} is already running on port ${port}.`,
        overrideEnv: definition.overrideEnv,
        command: definition.command,
        service
      };
    }

    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: "occupied_external",
      detail: service
        ? `Port ${port} is occupied by HappyTG ${service}, not ${definition.label}.`
        : `Port ${port} is occupied by another process.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service
    };
  }

  if (definition.probe === "redis") {
    const redisRunning = await probeRedis("127.0.0.1", port);
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: "occupied_external",
      detail: redisRunning
        ? `Redis is already listening on port ${port}.`
        : `Port ${port} is occupied by another process.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service: redisRunning ? "redis" : undefined
    };
  }

  return {
    id: definition.id,
    label: definition.label,
    port,
    probe: definition.probe,
    state: "occupied_external",
    detail: `Port ${port} is occupied.`,
    overrideEnv: definition.overrideEnv,
    command: definition.command
  };
}

async function detectCriticalPorts(env: NodeJS.ProcessEnv): Promise<PortCheckResult[]> {
  return Promise.all(criticalPortDefinitions.map((definition) => detectPortCheck(definition, env)));
}

async function detectRedis(
  env: NodeJS.ProcessEnv,
  options?: {
    cwd?: string;
    platform?: NodeJS.Platform;
  }
): Promise<RedisDetection> {
  const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    return {
      state: "remote",
      url: redisUrl,
      host: "",
      port: 6379,
      local: false,
      installed: false,
      detail: `REDIS_URL (${redisUrl}) is not a valid URL.`,
      executablePaths: {
        redisCli: null,
        redisServer: null
      }
    };
  }

  const host = parsedUrl.hostname;
  const port = safeUrlPort(parsedUrl, 6379);
  const local = isLocalRedisHost(host);
  const [redisCli, redisServer] = await Promise.all([
    resolveExecutable("redis-cli", {
      cwd: options?.cwd,
      env,
      platform: options?.platform
    }),
    resolveExecutable("redis-server", {
      cwd: options?.cwd,
      env,
      platform: options?.platform
    })
  ]);
  const installed = Boolean(redisCli || redisServer);

  if (!local) {
    return {
      state: "remote",
      url: redisUrl,
      host,
      port,
      local,
      installed,
      detail: `Redis is configured to use ${redisUrl}. Local host-port checks are skipped.`,
      executablePaths: {
        redisCli: redisCli ?? null,
        redisServer: redisServer ?? null
      }
    };
  }

  const redisRunning = await probeRedis(host || "127.0.0.1", port);
  if (redisRunning) {
    return {
      state: "running",
      url: redisUrl,
      host,
      port,
      local,
      installed,
      detail: `Redis responded to PING on ${host}:${port}.`,
      executablePaths: {
        redisCli: redisCli ?? null,
        redisServer: redisServer ?? null
      }
    };
  }

  const occupied = await canConnect(host || "127.0.0.1", port);
  if (occupied) {
    return {
      state: "port_conflict",
      url: redisUrl,
      host,
      port,
      local,
      installed,
      detail: `Port ${port} is occupied, but it did not answer a Redis PING.`,
      executablePaths: {
        redisCli: redisCli ?? null,
        redisServer: redisServer ?? null
      }
    };
  }

  return {
    state: installed ? "installed_stopped" : "absent",
    url: redisUrl,
    host,
    port,
    local,
    installed,
    detail: installed
      ? `Redis executables were found, but Redis is not running on ${host}:${port}.`
      : `Redis executables were not found and nothing is listening on ${host}:${port}.`,
    executablePaths: {
      redisCli: redisCli ?? null,
      redisServer: redisServer ?? null
    }
  };
}

function buildTokenMessage(tokenStatus: ReturnType<typeof telegramTokenStatus>, envFilePath: string | undefined, platform: NodeJS.Platform): string {
  const commands = platformCommands(platform);

  switch (tokenStatus.status) {
    case "missing":
    case "placeholder":
      return envFilePath
        ? "Telegram bot token is not configured. Set `TELEGRAM_BOT_TOKEN` in `.env`, then rerun `pnpm happytg setup`."
        : `Telegram bot token is not configured. Create \`.env\` with \`${commands.copyEnv}\`, set \`TELEGRAM_BOT_TOKEN\`, then rerun \`pnpm happytg setup\`.`;
    case "invalid":
      return "Telegram bot token format looks invalid. Update `TELEGRAM_BOT_TOKEN`, then rerun `pnpm happytg setup`.";
    case "configured":
    default:
      return "Telegram bot token is configured.";
  }
}

function buildPortConflictMessage(result: PortCheckResult, platform: NodeJS.Platform): string {
  if (!result.overrideEnv || !result.command) {
    return result.detail;
  }

  const suggestedPort = result.port + 1;
  const commands = platformCommands(platform);
  return `${result.detail} Reuse the running service if it is yours, or pick a new port with \`${commands.inlineEnvExample(result.overrideEnv, suggestedPort, result.command)}\`.`;
}

function buildSetupPlan(
  context: DoctorContext,
  redis: RedisDetection,
  portResults: PortCheckResult[],
  envFilePath: string | undefined,
  tokenState: ReturnType<typeof telegramTokenStatus>
): string[] {
  const platform = context.platform ?? process.platform;
  const commands = platformCommands(platform);
  const botTarget = telegramBotTarget(context.env ?? process.env);
  const steps: string[] = [];

  if (!envFilePath) {
    steps.push(`Create \`.env\`: \`${commands.copyEnv}\`.`);
  }

  if (tokenState.status !== "configured") {
    steps.push("Set `TELEGRAM_BOT_TOKEN` in `.env` or the shell before you start the bot.");
  }

  switch (redis.state) {
    case "running":
      steps.push("Redis is already running locally. Reuse it, and if `DATABASE_URL` plus `S3_ENDPOINT` already point at reachable services, you can skip Docker entirely.");
      break;
    case "installed_stopped":
      steps.push("Start your local Redis service, point `REDIS_URL` at an existing Redis instance, or include `redis` when you bring up shared infra.");
      break;
    case "absent":
      steps.push("If PostgreSQL, Redis, and S3-compatible storage already exist, point `DATABASE_URL`, `REDIS_URL`, and `S3_ENDPOINT` at them; otherwise bring up shared infra with Redis included.");
      break;
    case "port_conflict":
      steps.push("Port `6379` is busy. Reuse an existing Redis instance via `REDIS_URL`, or set `HAPPYTG_REDIS_HOST_PORT` before starting compose `redis`.");
      break;
    case "remote":
      steps.push("Redis points to a remote URL. Verify it is reachable before first start, and skip local Docker infra entirely if `DATABASE_URL` plus `S3_ENDPOINT` already point at reachable services.");
      break;
  }

  const infraCommand = defaultInfraComposeCommand(redis, platform);
  if (redis.state === "running") {
    steps.push(`If PostgreSQL and S3-compatible storage are not already available, start the remaining shared infra: \`${infraCommand}\`.`);
  } else if (redis.state === "port_conflict") {
    steps.push(`If you need container Redis, use \`${commands.inlineEnvExample("HAPPYTG_REDIS_HOST_PORT", 6380, "docker compose -f infra/docker-compose.example.yml up redis")}\`.`);
    steps.push(`Then start the remaining shared infra: \`docker compose -f infra/docker-compose.example.yml up postgres minio\`.`);
  } else if (redis.state === "remote") {
    steps.push("If PostgreSQL, Redis, and S3-compatible storage are already configured and reachable, continue without Docker. Otherwise start only the missing shared services.");
  } else {
    steps.push(`If you are not reusing existing PostgreSQL / Redis / S3-compatible services, start shared infra: \`${infraCommand}\`.`);
  }

  const occupiedHappyTGPorts = portResults.filter((item) => item.state === "occupied_expected" && ["miniapp", "api", "bot", "worker"].includes(item.id));
  if (occupiedHappyTGPorts.length > 0) {
    steps.push("Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy.");
  } else {
    steps.push("Start repo services: `pnpm dev`.");
  }

  steps.push("Request a pairing code on the execution host: `pnpm daemon:pair`.");
  steps.push(`Send \`/pair <CODE>\` to ${botTarget}, then start the daemon with \`pnpm dev:daemon\`.`);

  return steps.slice(0, 6);
}

export async function detectFindings(context: DoctorContext): Promise<DoctorDetection> {
  const findings: BootstrapFinding[] = [];
  const platform = context.platform ?? process.platform;
  const cwd = context.cwd ?? process.cwd();
  const env = context.env ?? process.env;
  const commands = platformCommands(platform);

  const platformLabel = `${platform}-${os.arch()}`;
  const envFilePath = findUpwardFile(cwd, ".env");
  const envExamplePath = findUpwardFile(cwd, ".env.example");
  const gitBinaryPath = await resolveExecutable("git", {
    cwd,
    env,
    platform
  });
  const hasGit = Boolean(gitBinaryPath);
  const codexResolution = await resolveCodexReadiness({
    cwd,
    env,
    platform
  });
  const codex = codexResolution.effective;
  const codexInstallCheck = codexResolution.installCheck;
  const actionableSmokeWarnings = classifyCodexSmokeStderr(codex.smokeError ?? "").actionableLines;
  const tokenState = telegramTokenStatus(env);
  const [redis, portResults] = await Promise.all([
    detectRedis(env, {
      cwd,
      platform
    }),
    detectCriticalPorts(env)
  ]);

  const preflight = [
    `Env: ${envPresenceSummary(envFilePath)}`,
    `Codex: ${formatCodexPreflightSummary({
      available: codex.available,
      missing: codex.missing,
      version: codex.version,
      pathPending: codexResolution.pathPending
    })}`,
    `Telegram: ${tokenState.status === "configured" ? "configured" : tokenState.status.replaceAll("_", " ")}`,
    `Redis: ${redisSummary(redis)}`,
    `Ports: ${formatPortStateForSummary(portResults)}`
  ];

  if (!envFilePath && envExamplePath) {
    pushFinding(findings, {
      code: "ENV_FILE_MISSING",
      severity: "warn",
      message: `\`.env\` was not found. Create it with \`${commands.copyEnv}\`, or export the required variables before first start.`
    });
  }

  if (!hasGit) {
    pushFinding(findings, {
      code: "GIT_MISSING",
      severity: "warn",
      message: "Git was not found in PATH. Install Git, verify `git --version`, then rerun `pnpm happytg doctor`."
    });
  }

  if (codexResolution.pathPending) {
    const binDir = detectedCodexBinDir(codexInstallCheck);
    pushFinding(findings, {
      code: "CODEX_PATH_PENDING",
      severity: "warn",
      message: binDir
        ? `Codex CLI worked through the npm wrapper at \`${codex.binaryPath}\`, but \`${binDir}\` is not on the current shell PATH yet. Update PATH or restart the shell so plain \`codex\` resolves directly.`
        : `Codex CLI worked through the npm wrapper at \`${codex.binaryPath}\`, but the current shell PATH is still missing that directory. Update PATH or restart the shell so plain \`codex\` resolves directly.`
    });
  }

  if (!codex.available && codex.missing !== false) {
    pushFinding(findings, {
      code: "CODEX_MISSING",
      severity: "error",
      message: codexMissingMessage(codexInstallCheck)
    });
  }

  if (!codex.available && codex.missing === false) {
    pushFinding(findings, {
      code: "CODEX_UNAVAILABLE",
      severity: "error",
      message: codexUnavailableMessage()
    });
  }

  if (!codex.configExists) {
    pushFinding(findings, {
      code: "CODEX_CONFIG_MISSING",
      severity: "warn",
      message: "Codex config was not found. Create `~/.codex/config.toml`, then rerun `pnpm happytg doctor`."
    });
  }

  if (codex.available && codex.configExists && !codex.smokeOk) {
    pushFinding(findings, {
      code: "CODEX_SMOKE_FAILED",
      severity: "warn",
      message: "Codex CLI started, but the smoke check did not complete. Review Codex auth/config, then rerun `pnpm happytg doctor --json`."
    });
  }

  if (codex.available && codex.configExists && codex.smokeOk && actionableSmokeWarnings.length > 0) {
    pushFinding(findings, {
      code: "CODEX_SMOKE_WARNINGS",
      severity: "warn",
      message: "Codex CLI completed the smoke check with warnings. Run `pnpm happytg doctor --json` for the detailed stderr output."
    });
  }

  if (tokenState.status !== "configured") {
    pushFinding(findings, {
      code: tokenState.status === "invalid" ? "TELEGRAM_TOKEN_INVALID" : "TELEGRAM_TOKEN_MISSING",
      severity: "error",
      message: buildTokenMessage(tokenState, envFilePath, platform)
    });
  }

  switch (redis.state) {
    case "installed_stopped":
      pushFinding(findings, {
        code: "REDIS_STOPPED",
        severity: "warn",
        message: "Redis appears to be installed but not running. Start Redis, point `REDIS_URL` at an existing Redis instance, or include `redis` when you bring up shared infra."
      });
      break;
    case "absent":
      pushFinding(findings, {
        code: "REDIS_MISSING",
        severity: "warn",
        message: "Redis was not detected locally. Start system Redis, point `REDIS_URL` at an existing Redis instance, or include `redis` when you bring up shared infra."
      });
      break;
    case "port_conflict":
      pushFinding(findings, {
        code: "REDIS_PORT_CONFLICT",
        severity: "warn",
        message: "Port `6379` is already allocated by a non-Redis process. Free it, use an existing Redis instance, or set `HAPPYTG_REDIS_HOST_PORT` for compose Redis."
      });
      break;
    default:
      break;
  }

  const occupiedHappyTGServices = portResults.filter((item) => item.state === "occupied_expected" && ["miniapp", "api", "bot", "worker"].includes(item.id));
  if (occupiedHappyTGServices.length > 0) {
    pushFinding(findings, {
      code: "SERVICES_ALREADY_RUNNING",
      severity: "info",
      message: `HappyTG services already appear to be running on ${occupiedHappyTGServices.map((item) => item.port).join(", ")}. Reuse the running stack or stop it before starting another copy.`
    });
  }

  for (const portResult of portResults) {
    if (portResult.state !== "occupied_external" || portResult.id === "redis") {
      continue;
    }

    pushFinding(findings, {
      code: `${portResult.id.toUpperCase()}_PORT_BUSY`,
      severity: "warn",
      message: buildPortConflictMessage(portResult, platform)
    });
  }

  const planPreview = context.command === "setup"
    ? buildSetupPlan(context, redis, portResults, envFilePath, tokenState)
    : [];

  if (findings.some((item) => item.code === "ENV_FILE_MISSING")) {
    pushPlanStep(planPreview, `Create \`.env\`: \`${commands.copyEnv}\`.`);
  }
  if (tokenState.status !== "configured") {
    pushPlanStep(planPreview, "Set `TELEGRAM_BOT_TOKEN`, then rerun `pnpm happytg setup`.");
  }
  if (codexResolution.pathPending) {
    const binDir = detectedCodexBinDir(codexInstallCheck);
    pushPlanStep(
      planPreview,
      binDir
        ? `Add \`${binDir}\` to PATH, restart the shell, then verify \`codex --version\`.`
        : "Add the npm global bin directory to PATH, restart the shell, then verify `codex --version`."
    );
  }
  if (!codex.available && codex.missing !== false) {
    if (codexInstallCheck?.pathLikelyIssue) {
      const binDir = detectedCodexBinDir(codexInstallCheck);
      pushPlanStep(
        planPreview,
        binDir
          ? `Add \`${binDir}\` to PATH, restart the shell, then verify \`codex --version\`.`
          : "Add the global npm bin directory to PATH, restart the shell, then verify `codex --version`."
      );
    } else {
      pushPlanStep(planPreview, "Reinstall Codex CLI, update PATH, then verify `codex --version`.");
    }
  }
  if (!codex.available && codex.missing === false) {
    pushPlanStep(planPreview, "Run `codex --version` in this shell, fix the local Codex install/runtime, then rerun `pnpm happytg setup`.");
  }
  if (redis.state === "running") {
    pushPlanStep(planPreview, "Redis is already running. Use it and skip compose `redis` unless you deliberately remap the host port.");
  }
  if (occupiedHappyTGServices.length > 0) {
    pushPlanStep(planPreview, "Do not run the full compose app stack and `pnpm dev` at the same time.");
  }
  for (const portResult of portResults.filter((item) => item.state === "occupied_external" && item.overrideEnv && item.command)) {
    const example = commands.inlineEnvExample(portResult.overrideEnv!, portResult.port + 1, portResult.command!);
    pushPlanStep(planPreview, `If you keep ${portResult.label.toLowerCase()} on a different port, use \`${example}\`.`);
  }

  if (context.command !== "setup" && planPreview.length === 0) {
    pushPlanStep(planPreview, "Run `pnpm happytg setup` for the guided first-start checklist.");
  }

  const profileRecommendation = findings.some((item) => item.severity === "error") ? "minimal" : "recommended";

  return {
    findings,
    planPreview,
    profileRecommendation,
    reportJson: {
      platform: platformLabel,
      env: {
        envFilePath: envFilePath ?? null,
        envExamplePath: envExamplePath ?? null
      },
      preflight,
      git: {
        available: hasGit,
        binaryPath: gitBinaryPath ?? null
      },
      codex,
      codexDirect: codexResolution.direct,
      codexInstallCheck: codexInstallCheck ?? null,
      codexPathResolution: {
        pathPending: codexResolution.pathPending,
        wrapperPath: codexResolution.wrapperPath ?? null
      },
      telegram: {
        status: tokenState.status,
        configured: tokenState.configured,
        message: buildTokenMessage(tokenState, envFilePath, platform)
      },
      redis,
      ports: portResults,
      onboarding: {
        copyEnvCommand: commands.copyEnv,
        defaultInfraCommand: defaultInfraComposeCommand(redis, platform),
        pairCommand: "pnpm daemon:pair",
        daemonCommand: "pnpm dev:daemon",
        steps: context.command === "setup" ? planPreview : buildSetupPlan(context, redis, portResults, envFilePath, tokenState),
        overrideExamples: criticalPortDefinitions
          .filter((item) => item.overrideEnv && item.command)
          .map((item) => ({
            service: item.label,
            defaultPort: item.defaultPort,
            overrideEnv: item.overrideEnv,
            command: item.command,
            shellExample: commands.inlineEnvExample(item.overrideEnv!, item.defaultPort + 1, item.command!)
          }))
      }
    }
  };
}

async function writeReport(
  command: BootstrapCommand,
  report: Omit<BootstrapReport, "id" | "command" | "createdAt">,
  context?: {
    env?: NodeJS.ProcessEnv;
  }
): Promise<BootstrapReport> {
  const createdAt = nowIso();
  const completeReport: BootstrapReport = {
    id: createId("btr"),
    command,
    createdAt,
    ...report
  };

  const stateDir = path.join(getLocalStateDir(context?.env), "state");
  await ensureDir(stateDir);
  const fileMap: Record<BootstrapCommand, string> = {
    doctor: "doctor-last.json",
    setup: "setup-last.json",
    repair: "repair-last.json",
    verify: "verify-last.json",
    status: "status-last.json",
    "config-init": "config-init-last.json",
    "env-snapshot": "env-snapshot-last.json"
  };

  await writeJsonFileAtomic(path.join(stateDir, fileMap[command]), completeReport);
  return completeReport;
}

export async function runDoctorLike(
  command: BootstrapCommand,
  context?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }
): Promise<BootstrapReport> {
  const detected = await detectFindings({
    command,
    cwd: context?.cwd,
    env: context?.env,
    platform: context?.platform
  });
  const status: BootstrapReport["status"] = detected.findings.some((item) => item.severity === "error")
    ? "fail"
    : detected.findings.some((item) => item.severity === "warn")
      ? "warn"
      : "pass";

  return writeReport(command, {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status,
    profileRecommendation: detected.profileRecommendation,
    findings: detected.findings,
    planPreview: detected.planPreview,
    reportJson: detected.reportJson
  }, {
    env: context?.env
  });
}

export async function runConfigInit(context?: {
  env?: NodeJS.ProcessEnv;
}): Promise<BootstrapReport> {
  const codexConfigPath = path.join(getLocalStateDir(context?.env).replace(/\.happytg$/, ".codex"), "config.toml");
  return writeReport("config-init", {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status: "warn",
    profileRecommendation: "minimal",
    findings: [
      {
        code: "CONFIG_INIT_PLAN_ONLY",
        severity: "info",
        message: `Config init is plan-only for now. Target path would be ${codexConfigPath}.`
      }
    ],
    planPreview: [
      "Create ~/.codex/config.toml if missing",
      "Backup existing config before edits"
    ],
    reportJson: {
      targetPath: codexConfigPath
    }
  }, context);
}

export async function runEnvSnapshot(): Promise<BootstrapReport> {
  return writeReport("env-snapshot", {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status: "pass",
    profileRecommendation: "recommended",
    findings: [],
    planPreview: [],
    reportJson: {
      platform: os.platform(),
      arch: os.arch(),
      cwd: process.cwd(),
      node: process.version,
      shell: process.env.SHELL ?? process.env.ComSpec ?? null
    }
  });
}

export async function runBootstrapCommand(
  command: BootstrapCommand,
  context?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }
): Promise<BootstrapReport> {
  switch (command) {
    case "doctor":
    case "setup":
    case "repair":
    case "verify":
    case "status":
      return runDoctorLike(command, context);
    case "config-init":
      return runConfigInit({
        env: context?.env
      });
    case "env-snapshot":
      return runEnvSnapshot();
    default:
      return runDoctorLike("status", context);
  }
}
