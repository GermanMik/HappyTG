import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { BootstrapFinding, BootstrapReport, RuntimeReadiness } from "../../protocol/src/index.js";
import { checkCodexReadiness, classifyCodexSmokeStderr, codexCliMissingMessage, summarizeCodexSmokeStderr } from "../../runtime-adapters/src/index.js";
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
import { legacyPlanPreviewFromAutomation, pushAutomationItem, type AutomationItem } from "./finalization.js";
import { inspectTelegramMenuDiagnostics } from "./telegram-menu.js";

export type BootstrapCommand = "doctor" | "setup" | "repair" | "verify" | "status" | "config-init" | "env-snapshot";

const INFRA_COMPOSE_FILE = "infra/docker-compose.example.yml";
const INFRA_COMPOSE_PREFIX = `docker compose --env-file .env -f ${INFRA_COMPOSE_FILE}`;

interface DoctorContext {
  command: BootstrapCommand;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface DoctorDetection {
  findings: BootstrapFinding[];
  planPreview: string[];
  onboardingItems: AutomationItem[];
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

type PortCheckState = "free" | "occupied_expected" | "occupied_supported" | "occupied_external";

interface PortListenerInfo {
  source: "probe" | "docker" | "unknown";
  kind: "happytg" | "redis" | "postgres" | "minio" | "http" | "tcp" | "unknown";
  description: string;
  service?: string;
  title?: string;
  serverHeader?: string;
  containerName?: string;
  image?: string;
}

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
  listener?: PortListenerInfo;
  suggestedPort?: number;
  suggestedPorts?: number[];
  planned: boolean;
}

interface DockerPublishedPort {
  containerName: string;
  image: string;
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
    envKeys: ["HAPPYTG_MINIAPP_PORT", "PORT"],
    defaultPort: 3001,
    probe: "http",
    expectedService: "miniapp",
    command: "pnpm dev:miniapp",
    overrideEnv: "HAPPYTG_MINIAPP_PORT"
  },
  {
    id: "api",
    label: "API",
    envKeys: ["HAPPYTG_API_PORT", "PORT"],
    defaultPort: 4000,
    probe: "http",
    expectedService: "api",
    command: "pnpm dev:api",
    overrideEnv: "HAPPYTG_API_PORT"
  },
  {
    id: "bot",
    label: "Bot",
    envKeys: ["HAPPYTG_BOT_PORT", "PORT"],
    defaultPort: 4100,
    probe: "http",
    expectedService: "bot",
    command: "pnpm dev:bot",
    overrideEnv: "HAPPYTG_BOT_PORT"
  },
  {
    id: "worker",
    label: "Worker probe",
    envKeys: ["HAPPYTG_WORKER_PORT", "PORT"],
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
    overrideEnv: "HAPPYTG_REDIS_HOST_PORT",
    command: `${INFRA_COMPOSE_PREFIX} up redis`
  },
  {
    id: "postgres",
    label: "Postgres host port",
    envKeys: ["HAPPYTG_POSTGRES_HOST_PORT"],
    defaultPort: 5432,
    probe: "tcp",
    overrideEnv: "HAPPYTG_POSTGRES_HOST_PORT",
    command: `${INFRA_COMPOSE_PREFIX} up postgres`
  },
  {
    id: "minio-api",
    label: "MinIO API host port",
    envKeys: ["HAPPYTG_MINIO_PORT"],
    defaultPort: 9000,
    probe: "tcp",
    overrideEnv: "HAPPYTG_MINIO_PORT",
    command: `${INFRA_COMPOSE_PREFIX} up minio`
  },
  {
    id: "minio-console",
    label: "MinIO console host port",
    envKeys: ["HAPPYTG_MINIO_CONSOLE_PORT"],
    defaultPort: 9001,
    probe: "tcp",
    overrideEnv: "HAPPYTG_MINIO_CONSOLE_PORT",
    command: `${INFRA_COMPOSE_PREFIX} up minio`
  }
] as const;

function pushFinding(findings: BootstrapFinding[], finding: BootstrapFinding): void {
  if (!findings.some((item) => item.code === finding.code && item.message === finding.message)) {
    findings.push(finding);
  }
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

function isLocalHost(host: string): boolean {
  return ["", "localhost", "127.0.0.1", "::1"].includes(host.trim().toLowerCase());
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
  const command = `${INFRA_COMPOSE_PREFIX} up ${services}`;

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

function codexSmokeFailedMessage(stderr: string): string {
  const summary = summarizeCodexSmokeStderr(stderr);
  return summary
    ? `Codex CLI started, but the smoke check failed: ${summary} Run \`pnpm happytg doctor --json\` for stderr details.`
    : "Codex CLI started, but the smoke check failed. Run `pnpm happytg doctor --json` for stderr details.";
}

function codexSmokeOutputLooksSuccessful(output: string | undefined): boolean {
  if (!output) {
    return false;
  }

  return /"text":"OK"/u.test(output)
    || /(^|\n)OK(\n|$)/u.test(output);
}

function codexSmokeFailureMessage(input: {
  stderr: string;
  output?: string;
  timedOut?: boolean;
}): string {
  const smokeDetails = [input.stderr, input.output].filter(Boolean).join("\n");
  const summary = summarizeCodexSmokeStderr(smokeDetails || input.stderr);
  if (input.timedOut && codexSmokeOutputLooksSuccessful(input.output)) {
    return summary
      ? `Codex CLI returned the smoke reply, but the process did not exit before the timeout: ${summary} Run \`pnpm happytg doctor --json\` for stderr details.`
      : "Codex CLI returned the smoke reply, but the process did not exit before the timeout. Run `pnpm happytg doctor --json` for stderr details.";
  }

  return summary
    ? `Codex CLI started, but the smoke check failed: ${summary} Run \`pnpm happytg doctor --json\` for stderr details.`
    : codexSmokeFailedMessage(input.stderr);
}

function codexSmokeWarningsMessage(stderr: string): string {
  const summary = summarizeCodexSmokeStderr(stderr);
  return summary
    ? `Codex CLI completed the smoke check with warnings: ${summary} Run \`pnpm happytg doctor --json\` for stderr details.`
    : "Codex CLI completed the smoke check with warnings. Run `pnpm happytg doctor --json` for the detailed stderr output.";
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

function plannedPortDefinitions(env: NodeJS.ProcessEnv): PortCheckDefinition[] {
  return criticalPortDefinitions.filter((definition) => {
    switch (definition.id) {
      case "redis": {
        const redisUrl = env.REDIS_URL?.trim();
        if (!redisUrl) {
          return true;
        }

        try {
          return isLocalHost(new URL(redisUrl).hostname);
        } catch {
          return true;
        }
      }
      case "postgres": {
        const databaseUrl = env.DATABASE_URL?.trim();
        if (!databaseUrl) {
          return true;
        }

        try {
          return isLocalHost(new URL(databaseUrl).hostname);
        } catch {
          return true;
        }
      }
      case "minio-api":
      case "minio-console": {
        const s3Endpoint = env.S3_ENDPOINT?.trim();
        if (!s3Endpoint) {
          return true;
        }

        try {
          return isLocalHost(new URL(s3Endpoint).hostname);
        } catch {
          return true;
        }
      }
      default:
        return true;
    }
  });
}

function formatPortStateForSummary(results: PortCheckResult[]): string {
  if (results.length === 0) {
    return "no local planned ports detected";
  }

  const free = results.filter((item) => item.state === "free").map((item) => `${item.label} ${item.port}`);
  const reuse = results
    .filter((item) => item.state === "occupied_expected" || item.state === "occupied_supported")
    .map((item) => `${item.label} ${item.port}`);
  const conflict = results.filter((item) => item.state === "occupied_external").map((item) => `${item.label} ${item.port}`);
  const summaryParts: string[] = [];

  if (conflict.length > 0) {
    summaryParts.push(`conflicts: ${conflict.join(", ")}`);
  }
  if (reuse.length > 0) {
    summaryParts.push(`reuse: ${reuse.join(", ")}`);
  }
  if (free.length > 0) {
    summaryParts.push(`free: ${free.join(", ")}`);
  }

  return summaryParts.join("; ");
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
  const spawnCommand = useShell ? buildWindowsShellCommand(command, args) : command;
  const timeoutMs = input.timeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, useShell ? [] : args, {
      cwd: input.cwd,
      env: normalizeSpawnEnv(input.env, input.platform),
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"]
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

function appendDockerPortRange(portMap: Map<number, DockerPublishedPort>, hostStart: number, hostEnd: number, containerName: string, image: string): void {
  for (let port = hostStart; port <= hostEnd; port += 1) {
    portMap.set(port, {
      containerName,
      image
    });
  }
}

function parseDockerPublishedPorts(stdout: string): Map<number, DockerPublishedPort> {
  const portMap = new Map<number, DockerPublishedPort>();

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const [containerName, portsField, image] = line.split("\t");
    if (!containerName || !portsField || !image) {
      continue;
    }

    for (const segment of portsField.split(",")) {
      const match = segment.trim().match(/(?:(?:\[[^\]]+\]|[^:]+):)?(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/tcp/iu);
      if (!match) {
        continue;
      }

      const hostStart = Number(match[1]);
      const hostEnd = Number(match[2] ?? match[1]);
      appendDockerPortRange(portMap, hostStart, hostEnd, containerName, image);
    }
  }

  return portMap;
}

async function detectDockerPublishedPorts(context: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): Promise<Map<number, DockerPublishedPort>> {
  const dockerRun = await runResolvedToolCommand({
    command: "docker",
    args: ["ps", "--format", "{{.Names}}\t{{.Ports}}\t{{.Image}}"],
    cwd: context.cwd,
    env: context.env,
    platform: context.platform,
    timeoutMs: 5_000
  }).catch(() => undefined);
  if (!dockerRun || dockerRun.exitCode !== 0) {
    return new Map();
  }

  return parseDockerPublishedPorts(dockerRun.stdout);
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

async function probeGenericHttpListener(port: number): Promise<PortListenerInfo | undefined> {
  const urls = [
    `http://127.0.0.1:${port}/ready`,
    `http://127.0.0.1:${port}/health`,
    `http://127.0.0.1:${port}/minio/health/live`,
    `http://127.0.0.1:${port}/`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(750)
      });
      const contentType = response.headers.get("content-type") ?? "";
      const serverHeader = response.headers.get("server") ?? undefined;
      const bodyText = (contentType.includes("json") || contentType.startsWith("text/"))
        ? await response.text()
        : "";
      if (contentType.includes("application/json")) {
        try {
          const body = JSON.parse(bodyText) as { service?: string };
          if (body.service) {
            return {
              source: "probe",
              kind: "happytg",
              service: body.service,
              description: `HappyTG ${body.service}`
            };
          }
        } catch {
          // Ignore malformed JSON and keep probing for another fingerprint.
        }
      }

      if (!response.ok) {
        continue;
      }

      const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/iu);
      const title = titleMatch?.[1]?.trim();
      if (serverHeader?.toLowerCase().includes("minio") || title?.toLowerCase().includes("minio")) {
        return {
          source: "probe",
          kind: "minio",
          description: title ? `MinIO listener (${title})` : "MinIO listener",
          title,
          serverHeader
        };
      }

      if (response.ok) {
        return {
          source: "probe",
          kind: "http",
          description: title ? `HTTP listener (${title})` : `HTTP listener (${response.status})`,
          title,
          serverHeader
        };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function detectHappyTGServiceOnPort(port: number): Promise<string | undefined> {
  return (await probeGenericHttpListener(port))?.service;
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

async function probePostgres(host: string, port: number, timeoutMs = 500): Promise<boolean> {
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
      socket.write(Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]));
    });
    socket.on("data", (chunk) => {
      finish(chunk.length > 0 && (chunk[0] === 0x53 || chunk[0] === 0x4e));
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function withDockerAttribution(listener: PortListenerInfo | undefined, dockerPort: DockerPublishedPort | undefined): PortListenerInfo | undefined {
  if (!dockerPort) {
    return listener;
  }

  if (!listener) {
    return {
      source: "docker",
      kind: "unknown",
      description: `Docker container \`${dockerPort.containerName}\` (${dockerPort.image})`,
      containerName: dockerPort.containerName,
      image: dockerPort.image
    };
  }

  return {
    ...listener,
    source: "docker",
    containerName: dockerPort.containerName,
    image: dockerPort.image,
    description: `${listener.description} via Docker container \`${dockerPort.containerName}\` (${dockerPort.image})`
  };
}

async function detectPortCheck(
  definition: PortCheckDefinition,
  port: number,
  suggestedPorts: number[],
  env: NodeJS.ProcessEnv,
  dockerPorts: Map<number, DockerPublishedPort>
): Promise<PortCheckResult> {
  const suggestedPort = suggestedPorts[0] ?? (port + 1);
  const dockerListener = dockerPorts.get(port);
  const connected = await canConnect("127.0.0.1", port);
  if (!connected) {
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: "free",
      detail: `${definition.label} plans to use port ${port}; it is free.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      suggestedPort,
      suggestedPorts,
      planned: true
    };
  }

  if (definition.probe === "http") {
    const listener = withDockerAttribution(await probeGenericHttpListener(port), dockerListener);
    const service = listener?.service;
    if (service && service === definition.expectedService) {
      return {
        id: definition.id,
        label: definition.label,
        port,
        probe: definition.probe,
        state: "occupied_expected",
        detail: `${definition.label} plans to use port ${port}, and HappyTG ${service} is already running there${listener?.containerName ? ` via Docker container \`${listener.containerName}\`` : ""}.`,
        overrideEnv: definition.overrideEnv,
        command: definition.command,
        service,
        listener,
        suggestedPort,
        suggestedPorts,
        planned: true
      };
    }

    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: "occupied_external",
      detail: service
        ? `${definition.label} plans to use port ${port}, but HappyTG ${service} is already running there.`
        : `${definition.label} plans to use port ${port}, but ${listener?.description ?? "another process or listener"} is already there.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service,
      listener,
      suggestedPort,
      suggestedPorts,
      planned: true
    };
  }

  if (definition.probe === "redis") {
    const redisRunning = await probeRedis("127.0.0.1", port);
    const listener = withDockerAttribution(
      redisRunning
        ? {
          source: "probe",
          kind: "redis",
          description: "Redis listener",
          service: "redis"
        }
        : undefined,
      dockerListener
    );
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: redisRunning ? "occupied_supported" : "occupied_external",
      detail: redisRunning
        ? `${definition.label} plans to use port ${port}, and ${listener?.description ?? "Redis"} is already available there.`
        : `${definition.label} plans to use port ${port}, but ${listener?.description ?? "another process or listener"} is already there.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service: redisRunning ? "redis" : undefined,
      listener,
      suggestedPort,
      suggestedPorts,
      planned: true
    };
  }

  if (definition.id === "postgres") {
    const postgresRunning = await probePostgres("127.0.0.1", port);
    const listener = withDockerAttribution(
      postgresRunning
        ? {
          source: "probe",
          kind: "postgres",
          description: "PostgreSQL listener",
          service: "postgres"
        }
        : undefined,
      dockerListener
    );
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: postgresRunning ? "occupied_supported" : "occupied_external",
      detail: postgresRunning
        ? `${definition.label} plans to use port ${port}, and ${listener?.description ?? "PostgreSQL"} is already available there.`
        : `${definition.label} plans to use port ${port}, but ${listener?.description ?? "another process or listener"} is already there.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service: postgresRunning ? "postgres" : undefined,
      listener,
      suggestedPort,
      suggestedPorts,
      planned: true
    };
  }

  if (definition.id === "minio-api" || definition.id === "minio-console") {
    const listener = withDockerAttribution(await probeGenericHttpListener(port), dockerListener);
    const minioRunning = listener?.kind === "minio";
    return {
      id: definition.id,
      label: definition.label,
      port,
      probe: definition.probe,
      state: minioRunning ? "occupied_supported" : "occupied_external",
      detail: minioRunning
        ? `${definition.label} plans to use port ${port}, and ${listener?.description ?? "MinIO"} is already available there.`
        : `${definition.label} plans to use port ${port}, but ${listener?.description ?? "another process or listener"} is already there.`,
      overrideEnv: definition.overrideEnv,
      command: definition.command,
      service: minioRunning ? "minio" : undefined,
      listener,
      suggestedPort,
      suggestedPorts,
      planned: true
    };
  }

  return {
    id: definition.id,
    label: definition.label,
    port,
    probe: definition.probe,
    state: "occupied_external",
    detail: `${definition.label} plans to use port ${port}, but ${withDockerAttribution(undefined, dockerListener)?.description ?? "another process or listener"} is already there.`,
    overrideEnv: definition.overrideEnv,
    command: definition.command,
    listener: withDockerAttribution(undefined, dockerListener),
    suggestedPort,
    suggestedPorts,
    planned: true
  };
}

async function findSuggestedPorts(
  port: number,
  blockedPorts: Set<number>,
  count = 3
): Promise<number[]> {
  const suggestedPorts: number[] = [];
  for (let candidate = port + 1; candidate < 65_535; candidate += 1) {
    if (suggestedPorts.length >= count) {
      break;
    }
    if (blockedPorts.has(candidate)) {
      continue;
    }
    if (await canConnect("127.0.0.1", candidate)) {
      continue;
    }
    suggestedPorts.push(candidate);
    blockedPorts.add(candidate);
  }

  if (suggestedPorts.length === 0) {
    suggestedPorts.push(port + 1);
  }

  return suggestedPorts;
}

async function detectCriticalPorts(context: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): Promise<PortCheckResult[]> {
  const definitions = plannedPortDefinitions(context.env);
  const dockerPorts = await detectDockerPublishedPorts(context);
  const plannedPorts = definitions.map((definition) => ({
    definition,
    port: definition.envKeys.length > 0
      ? readPort(context.env, definition.envKeys, definition.defaultPort)
      : definition.defaultPort
  }));
  const blockedPorts = new Set(plannedPorts.map((item) => item.port));
  const suggestedPorts = new Map<string, number[]>();

  for (const plannedPort of plannedPorts) {
    suggestedPorts.set(
      plannedPort.definition.id,
      await findSuggestedPorts(plannedPort.port, blockedPorts)
    );
  }

  return Promise.all(plannedPorts.map((plannedPort) => detectPortCheck(
    plannedPort.definition,
    plannedPort.port,
    suggestedPorts.get(plannedPort.definition.id) ?? [plannedPort.port + 1],
    context.env,
    dockerPorts
  )));
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

function buildPortConflictItem(result: PortCheckResult, platform: NodeJS.Platform): AutomationItem {
  const commands = platformCommands(platform);

  if (!result.overrideEnv || !result.command) {
    return {
      id: `${result.id}-port-conflict`,
      kind: "conflict",
      message: result.detail
    };
  }

  const suggestedPorts = [...new Set([
    ...(result.suggestedPorts ?? []),
    result.suggestedPort ?? (result.port + 1)
  ])].slice(0, 3);
  const suggestedPort = suggestedPorts[0] ?? (result.port + 1);
  const overrideEnvReference = ["miniapp", "api", "bot", "worker"].includes(result.id)
    ? `${result.overrideEnv}/PORT`
    : result.overrideEnv;
  return {
    id: `${result.id}-port-conflict`,
    kind: "conflict",
    message: result.detail,
    solutions: [
      "This is a conflict, not a supported HappyTG reuse path.",
      `Nearest free ports: ${suggestedPorts.join(", ")}.`,
      `Choose one with \`${overrideEnvReference}\` or enter your own port manually. For example: \`${commands.inlineEnvExample(result.overrideEnv, suggestedPort, result.command)}\`.`
    ]
  };
}

function buildPortConflictMessage(result: PortCheckResult, platform: NodeJS.Platform): string {
  const item = buildPortConflictItem(result, platform);
  return [item.message, ...(item.solutions ?? [])].join(" ");
}

function buildOnboardingItems(input: {
  context: DoctorContext;
  redis: RedisDetection;
  portResults: PortCheckResult[];
  envFilePath: string | undefined;
  tokenState: ReturnType<typeof telegramTokenStatus>;
  codexResolution: CodexReadinessResolution;
  codexInstallCheck?: CodexInstallCheck;
}): AutomationItem[] {
  const {
    context,
    redis,
    portResults,
    envFilePath,
    tokenState,
    codexResolution,
    codexInstallCheck
  } = input;
  const platform = context.platform ?? process.platform;
  const commands = platformCommands(platform);
  const botTarget = telegramBotTarget(context.env ?? process.env);
  const items: AutomationItem[] = [];
  const postgresReady = portResults.some((item) => item.id === "postgres" && item.state === "occupied_supported");
  const minioReady = portResults.some((item) => item.id === "minio-api" && item.state === "occupied_supported");
  const sharedInfraReady = redis.state === "running" && postgresReady && minioReady;
  const runningHappyTGServices = portResults.filter((item) => item.state === "occupied_expected" && ["miniapp", "api", "bot", "worker"].includes(item.id));
  const conflictingAppPorts = portResults.filter((item) => item.state === "occupied_external" && ["miniapp", "api", "bot", "worker"].includes(item.id));
  const apiReady = portResults.some((item) => item.id === "api" && item.state === "occupied_expected");

  if (codexResolution.pathPending) {
    const binDir = detectedCodexBinDir(codexInstallCheck);
    pushAutomationItem(items, {
      id: "codex-path-pending",
      kind: "warning",
      message: binDir
        ? `Codex CLI is usable, but \`${binDir}\` is not on PATH in the current shell yet.`
        : "Codex CLI is usable, but the npm global bin directory is not on PATH in the current shell yet.",
      solutions: [
        binDir
          ? `Add \`${binDir}\` to PATH.`
          : "Add the npm global bin directory to PATH.",
        "Restart the shell.",
        "Verify `codex --version`."
      ]
    });
  }

  if (!codexResolution.effective.available && codexResolution.effective.missing !== false) {
    if (codexInstallCheck?.pathLikelyIssue) {
      const binDir = detectedCodexBinDir(codexInstallCheck);
      pushAutomationItem(items, {
        id: "codex-install",
        kind: "blocked",
        message: binDir
          ? "Codex CLI wrapper files were found, but this shell still cannot resolve them directly."
          : "Codex CLI appears installed incompletely in this shell.",
        solutions: [
          binDir
            ? `Add \`${binDir}\` to PATH.`
            : "Add the global npm bin directory to PATH.",
          "Restart the shell.",
          "Verify `codex --version`."
        ]
      });
    } else {
      pushAutomationItem(items, {
        id: "codex-install",
        kind: "blocked",
        message: "Codex CLI is not installed correctly in this shell yet.",
        solutions: [
          "Reinstall Codex CLI.",
          "Update PATH if needed.",
          "Verify `codex --version`."
        ]
      });
    }
  }

  if (!codexResolution.effective.available && codexResolution.effective.missing === false) {
    pushAutomationItem(items, {
      id: "codex-runtime",
      kind: "blocked",
      message: "Codex CLI was found, but it is not healthy in the current shell.",
      solutions: [
        "Run `codex --version` in this shell.",
        "Fix the local Codex install/runtime.",
        `Rerun \`pnpm happytg ${context.command}\`.`
      ]
    });
  }

  if (!envFilePath) {
    pushAutomationItem(items, {
      id: "env-create",
      kind: "manual",
      message: `Create \`.env\`: \`${commands.copyEnv}\`.`
    });
  }

  if (tokenState.status !== "configured") {
    pushAutomationItem(items, {
      id: "telegram-token",
      kind: "blocked",
      message: tokenState.status === "invalid"
        ? "Telegram bot token format looks invalid."
        : "Telegram bot token is missing.",
      solutions: tokenState.status === "invalid"
        ? [
          "Update `TELEGRAM_BOT_TOKEN` in `.env` or the shell.",
          `Rerun \`pnpm happytg ${context.command}\` after the token is fixed.`
        ]
        : [
          "Set `TELEGRAM_BOT_TOKEN` in `.env` or the shell.",
          `Rerun \`pnpm happytg ${context.command}\` after the token is set.`
        ]
    });
  }

  if (sharedInfraReady) {
    pushAutomationItem(items, {
      id: "shared-infra-ready",
      kind: "reuse",
      message: "Redis, PostgreSQL, and S3-compatible storage already look reachable locally. Reuse them and skip Docker shared infra entirely."
    });
  } else {
    switch (redis.state) {
      case "running":
        pushAutomationItem(items, {
          id: "redis-reuse",
          kind: "reuse",
          message: "Redis is already running locally. Reuse it, and if `DATABASE_URL` plus `S3_ENDPOINT` already point at reachable services, you can skip Docker entirely."
        });
        break;
      case "installed_stopped":
        pushAutomationItem(items, {
          id: "redis-start",
          kind: "manual",
          message: "Start your local Redis service, point `REDIS_URL` at an existing Redis instance, or include `redis` when you bring up shared infra."
        });
        break;
      case "absent":
        pushAutomationItem(items, {
          id: "shared-infra-missing",
          kind: "manual",
          message: "If PostgreSQL, Redis, and S3-compatible storage already exist, point `DATABASE_URL`, `REDIS_URL`, and `S3_ENDPOINT` at them; otherwise bring up shared infra with Redis included."
        });
        break;
      case "port_conflict":
        pushAutomationItem(items, {
          id: "redis-port-conflict",
          kind: "conflict",
          message: "Port `6379` is busy.",
          solutions: [
            "Reuse an existing Redis instance via `REDIS_URL`.",
            "Or set `HAPPYTG_REDIS_HOST_PORT` before starting compose `redis`."
          ]
        });
        break;
      case "remote":
        pushAutomationItem(items, {
          id: "redis-remote",
          kind: "warning",
          message: "Redis points to a remote URL. Verify it is reachable before first start, and skip local Docker infra entirely if `DATABASE_URL` plus `S3_ENDPOINT` already point at reachable services."
        });
        break;
    }
  }

  const infraCommand = defaultInfraComposeCommand(redis, platform);
  if (!sharedInfraReady) {
    if (redis.state === "running") {
      pushAutomationItem(items, {
        id: "shared-infra-remaining",
        kind: "manual",
        message: `If PostgreSQL and S3-compatible storage are not already available, start the remaining shared infra: \`${infraCommand}\`.`
      });
    } else if (redis.state === "port_conflict") {
      pushAutomationItem(items, {
        id: "redis-remap",
        kind: "conflict",
        message: `If you need container Redis, use \`${commands.inlineEnvExample("HAPPYTG_REDIS_HOST_PORT", 6380, `${INFRA_COMPOSE_PREFIX} up redis`)}\`.`
      });
      pushAutomationItem(items, {
        id: "shared-infra-remaining",
        kind: "manual",
        message: `Then start the remaining shared infra: \`${INFRA_COMPOSE_PREFIX} up postgres minio\`.`
      });
    } else if (redis.state === "remote") {
      pushAutomationItem(items, {
        id: "shared-infra-remote",
        kind: "warning",
        message: "If PostgreSQL, Redis, and S3-compatible storage are already configured and reachable, continue without Docker. Otherwise start only the missing shared services."
      });
    } else {
      pushAutomationItem(items, {
        id: "shared-infra-start",
        kind: "manual",
        message: `If you are not reusing existing PostgreSQL / Redis / S3-compatible services, start shared infra: \`${infraCommand}\`.`
      });
    }
  }

  if (runningHappyTGServices.length > 0) {
    pushAutomationItem(items, {
      id: "running-stack-reuse",
      kind: "reuse",
      message: "Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy."
    });
  } else if (conflictingAppPorts.length === 0) {
    pushAutomationItem(items, {
      id: "start-repo-services",
      kind: "manual",
      message: "Start repo services: `pnpm dev`."
    });
  } else {
    pushAutomationItem(items, {
      id: "start-repo-services",
      kind: "blocked",
      message: "Some HappyTG application ports are occupied, so another `pnpm dev` stack cannot start yet.",
      solutions: [
        "Resolve the listed port conflicts below.",
        "Or reuse the running stack instead of starting another copy."
      ]
    });
  }

  for (const portResult of conflictingAppPorts) {
    pushAutomationItem(items, buildPortConflictItem(portResult, platform));
  }

  if (tokenState.status !== "configured") {
    pushAutomationItem(items, {
      id: "request-pair-code",
      kind: "blocked",
      message: "Pairing is blocked because Telegram bot configuration is incomplete.",
      solutions: [
        "Fix the Telegram bot configuration first.",
        `Rerun \`pnpm happytg ${context.command}\` after the bot token is valid.`
      ]
    });
    return items;
  }

  if (!apiReady) {
    pushAutomationItem(items, {
      id: "request-pair-code",
      kind: "blocked",
      message: "Pairing is blocked because the HappyTG API is not running yet.",
      solutions: [
        "Start or reuse the HappyTG API first.",
        "Then request a pairing code with `pnpm daemon:pair`."
      ]
    });
    return items;
  }

  pushAutomationItem(items, {
    id: "request-pair-code",
    kind: "manual",
    message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
  });
  pushAutomationItem(items, {
    id: "complete-pairing",
    kind: "manual",
    message: botTarget === "Telegram"
      ? "Send `/pair <CODE>` in Telegram."
      : `Send \`/pair <CODE>\` to ${botTarget}.`
  });
  pushAutomationItem(items, {
    id: "start-daemon",
    kind: "manual",
    message: "After pairing, start the daemon with `pnpm dev:daemon`."
  });

  return items;
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
  const [redis, portResults, telegramMenu] = await Promise.all([
    detectRedis(env, {
      cwd,
      platform
    }),
    detectCriticalPorts({
      cwd,
      env,
      platform
    }),
    inspectTelegramMenuDiagnostics({
      cwd,
      env,
      preflightTimeoutMs: 2_500
    })
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
    `Telegram Mini App URL: ${telegramMenu.miniAppUrl.ok ? telegramMenu.miniAppUrl.value : telegramMenu.miniAppUrl.message}`,
    `Caddy /miniapp: ${telegramMenu.caddy.checked ? telegramMenu.caddy.message : "not checked"}`,
    `Telegram menu button: ${telegramMenu.menuButton.message}`,
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
      message: codexSmokeFailureMessage({
        stderr: codex.smokeError ?? "",
        output: codex.smokeOutput,
        timedOut: codex.smokeTimedOut
      })
    });
  }

  if (codex.available && codex.configExists && codex.smokeOk && actionableSmokeWarnings.length > 0) {
    pushFinding(findings, {
      code: "CODEX_SMOKE_WARNINGS",
      severity: "warn",
      message: codexSmokeWarningsMessage(codex.smokeError ?? "")
    });
  }

  if (tokenState.status !== "configured") {
    pushFinding(findings, {
      code: tokenState.status === "invalid" ? "TELEGRAM_TOKEN_INVALID" : "TELEGRAM_TOKEN_MISSING",
      severity: "error",
      message: buildTokenMessage(tokenState, envFilePath, platform)
    });
  }

  if (!telegramMenu.miniAppUrl.ok) {
    pushFinding(findings, {
      code: "TELEGRAM_MINIAPP_URL_UNSAFE",
      severity: "info",
      message: `${telegramMenu.miniAppUrl.message} Production menu setup stays blocked until \`pnpm happytg telegram menu set\` can use a public HTTPS /miniapp URL.`
    });
  }

  if (telegramMenu.caddy.checked && telegramMenu.caddy.ok === false) {
    pushFinding(findings, {
      code: "CADDY_MINIAPP_ROUTE_UNAVAILABLE",
      severity: "warn",
      message: `${telegramMenu.caddy.message} Fix the public Caddy route before running \`pnpm happytg telegram menu set\`.`
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

  const onboardingItems = buildOnboardingItems({
    context,
    redis,
    portResults,
    envFilePath,
    tokenState,
    codexResolution,
    codexInstallCheck: codexInstallCheck ?? undefined
  });
  const planPreview = legacyPlanPreviewFromAutomation(onboardingItems);

  const profileRecommendation = findings.some((item) => item.severity === "error") ? "minimal" : "recommended";

  return {
    findings,
    planPreview,
    onboardingItems,
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
      telegramMenu,
      redis,
      ports: portResults,
      plannedPorts: portResults,
      onboarding: {
        copyEnvCommand: commands.copyEnv,
        defaultInfraCommand: defaultInfraComposeCommand(redis, platform),
        pairCommand: "pnpm daemon:pair",
        daemonCommand: "pnpm dev:daemon",
        items: onboardingItems,
        steps: planPreview,
        overrideExamples: portResults
          .filter((item) => item.overrideEnv && item.command)
          .map((item) => ({
            service: item.label,
            defaultPort: item.port,
            overrideEnv: item.overrideEnv,
            command: item.command,
            shellExample: commands.inlineEnvExample(item.overrideEnv!, item.suggestedPort ?? (item.port + 1), item.command!)
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
