import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  fileExists,
  getLocalStateDir,
  readTextFileOrEmpty,
  resolveExecutable,
  resolveHome,
  writeTextFileAtomic
} from "../../../shared/src/index.js";

import { runCommand } from "./commands.js";
import type {
  DockerCaddyAction,
  DockerServiceId,
  DockerServiceStrategy,
  DockerServiceStrategyPlan,
  SystemCaddyPlan
} from "./types.js";

const COMPOSE_APP_SERVICES = ["api", "worker", "bot", "miniapp", "prometheus", "grafana"];
const COMPOSE_APP_SERVICES_WITH_CADDY = [...COMPOSE_APP_SERVICES, "caddy"];
const HAPPYTG_CADDY_BEGIN = "# BEGIN HappyTG managed block";
const HAPPYTG_CADDY_END = "# END HappyTG managed block";

export const DOCKER_COMPOSE_FILE = "infra/docker-compose.example.yml";
export const DOCKER_COMPOSE_PREFIX = `docker compose --env-file .env -f ${DOCKER_COMPOSE_FILE}`;

function localHostForContainers(platform: NodeJS.Platform): string {
  return platform === "win32" || platform === "darwin" || platform === "linux"
    ? "host.docker.internal"
    : "host.docker.internal";
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

function translateEndpointForContainers(input: {
  raw: string;
  platform: NodeJS.Platform;
}): { value: string; needsHostGateway: boolean } {
  try {
    const url = new URL(input.raw);
    if (!isLoopbackHost(url.hostname)) {
      return {
        value: input.raw,
        needsHostGateway: false
      };
    }

    url.hostname = localHostForContainers(input.platform);
    return {
      value: url.toString(),
      needsHostGateway: input.platform === "linux"
    };
  } catch {
    return {
      value: input.raw,
      needsHostGateway: false
    };
  }
}

function publicDomain(env: NodeJS.ProcessEnv): string {
  if (env.HAPPYTG_DOMAIN?.trim()) {
    return env.HAPPYTG_DOMAIN.trim();
  }

  for (const key of ["HAPPYTG_MINIAPP_URL", "HAPPYTG_PUBLIC_URL"]) {
    const value = env[key]?.trim();
    if (!value) {
      continue;
    }
    try {
      const url = new URL(value);
      if (url.hostname) {
        return url.hostname;
      }
    } catch {
      // Ignore invalid operator input here; the regular URL checks report it.
    }
  }

  return "happytg.example.com";
}

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  const parsed = raw ? Number(raw) : fallback;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

export function generateSystemCaddySnippet(env: NodeJS.ProcessEnv): string {
  const domain = publicDomain(env);
  const apiPort = readPort(env, "HAPPYTG_API_PORT", 4000);
  const botPort = readPort(env, "HAPPYTG_BOT_PORT", 4100);
  const miniappPort = readPort(env, "HAPPYTG_MINIAPP_PORT", 3001);

  return [
    HAPPYTG_CADDY_BEGIN,
    `${domain} {`,
    "\tencode zstd gzip",
    "",
    "\thandle /health {",
    `\t\treverse_proxy 127.0.0.1:${apiPort}`,
    "\t}",
    "",
    "\thandle /api/v1/miniapp/auth/session {",
    `\t\treverse_proxy 127.0.0.1:${apiPort}`,
    "\t}",
    "",
    "\thandle /api/v1/miniapp/dashboard {",
    `\t\treverse_proxy 127.0.0.1:${apiPort}`,
    "\t}",
    "",
    "\t@miniappApprovalResolve path_regexp miniapp_approval_resolve ^/api/v1/miniapp/approvals/[^/]+/resolve$",
    "\thandle @miniappApprovalResolve {",
    `\t\treverse_proxy 127.0.0.1:${apiPort}`,
    "\t}",
    "",
    "\thandle /api/* {",
    "\t\trespond \"Not found\" 404",
    "\t}",
    "",
    "\thandle /telegram/webhook {",
    `\t\treverse_proxy 127.0.0.1:${botPort}`,
    "\t}",
    "",
    "\thandle_path /miniapp* {",
    `\t\treverse_proxy 127.0.0.1:${miniappPort} {`,
    "\t\t\theader_up X-Forwarded-Prefix /miniapp",
    "\t\t}",
    "\t}",
    "",
    "\thandle_path /static* {",
    `\t\treverse_proxy 127.0.0.1:${miniappPort}`,
    "\t}",
    "",
    "\thandle {",
    "\t\tredir * /miniapp 302",
    "\t}",
    "}",
    HAPPYTG_CADDY_END,
    ""
  ].join("\n");
}

function candidateCaddyfilePaths(input: {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  requestedPath?: string;
}): string[] {
  const candidates = [
    input.requestedPath,
    input.env.HAPPYTG_CADDYFILE,
    input.env.CADDYFILE
  ];

  if (input.platform === "win32") {
    candidates.push(resolveHome("~/AppData/Roaming/Caddy/Caddyfile", {
      env: input.env,
      platform: input.platform
    }));
    if (input.env.ProgramData) {
      candidates.push(path.join(input.env.ProgramData, "Caddy", "Caddyfile"));
    }
  } else if (input.platform === "darwin") {
    candidates.push("/usr/local/etc/caddy/Caddyfile", "/opt/homebrew/etc/caddy/Caddyfile");
  } else {
    candidates.push("/etc/caddy/Caddyfile");
  }

  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate?.trim())))];
}

function hasHappyTGRoutes(text: string, env: NodeJS.ProcessEnv): boolean {
  const domain = publicDomain(env);
  const reverseProxyCount = (text.match(/\breverse_proxy\b/gu) ?? []).length;
  const hasDomain = text.includes(domain) || text.includes("HAPPYTG_DOMAIN") || text.includes("happytg");
  const requiredTokens = [
    "/miniapp",
    "/static",
    "/telegram/webhook",
    "/api/v1/miniapp/auth/session",
    "/api/v1/miniapp/dashboard",
    "/api/v1/miniapp/approvals",
    "handle /api/*",
    "respond \"Not found\" 404",
    "X-Forwarded-Prefix"
  ];

  return hasDomain
    && reverseProxyCount >= 3
    && requiredTokens.every((token) => text.includes(token));
}

async function runCaddyCommand(input: {
  id: string;
  caddyPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  commands: string[];
  runCommandImpl: typeof runCommand;
}): Promise<{ ok: boolean; output: string }> {
  const result = await input.runCommandImpl({
    command: input.caddyPath,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  }).catch((error) => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : "Caddy command failed.",
    exitCode: 1,
    binaryPath: input.caddyPath,
    shell: false,
    fallbackUsed: false
  }));
  input.commands.push(`${input.caddyPath} ${input.args.join(" ")}`);
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout}\n${result.stderr}`.trim()
  };
}

async function detectExistingHappyTGCaddy(input: {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  requestedPath?: string;
  caddyPath?: string;
  runCommandImpl: typeof runCommand;
}): Promise<SystemCaddyPlan | undefined> {
  const commands: string[] = [];
  for (const candidate of candidateCaddyfilePaths(input)) {
    if (!(await fileExists(candidate))) {
      continue;
    }

    const text = await readTextFileOrEmpty(candidate);
    if (!hasHappyTGRoutes(text, input.env)) {
      continue;
    }

    if (!input.caddyPath) {
      return {
        action: "print-snippet",
        status: "blocked",
        caddyfilePath: candidate,
        commands,
        warnings: ["Existing HappyTG-looking Caddy routes were found, but the `caddy` binary was not available to validate them."],
        detail: `Found candidate HappyTG Caddy routes at ${candidate}, but validation could not run.`
      };
    }

    const validation = await runCaddyCommand({
      id: "caddy-validate",
      caddyPath: input.caddyPath,
      args: ["validate", "--config", candidate],
      cwd: input.repoPath,
      env: input.env,
      platform: input.platform,
      commands,
      runCommandImpl: input.runCommandImpl
    });
    if (validation.ok) {
      return {
        action: "reuse-system",
        status: "reuse",
        caddyfilePath: candidate,
        commands,
        warnings: [],
        detail: `System Caddy already has HappyTG routes and validated cleanly at ${candidate}.`
      };
    }

    return {
      action: "print-snippet",
      status: "blocked",
      caddyfilePath: candidate,
      commands,
      warnings: [`Existing HappyTG-looking Caddy routes at ${candidate} did not validate: ${validation.output || "caddy validate failed."}`],
      detail: `System Caddy route reuse is blocked until ${candidate} validates.`
    };
  }

  return undefined;
}

async function writeSnippet(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): Promise<{ snippet: string; snippetPath: string }> {
  const snippet = generateSystemCaddySnippet(input.env);
  const snippetPath = path.join(getLocalStateDir(input.env, input.platform), "state", "caddy", "happytg-system-caddy.Caddyfile");
  await writeTextFileAtomic(snippetPath, snippet);
  return { snippet, snippetPath };
}

function patchCaddyfileText(current: string, snippet: string): string {
  const beginIndex = current.indexOf(HAPPYTG_CADDY_BEGIN);
  const endIndex = current.indexOf(HAPPYTG_CADDY_END);
  if (beginIndex >= 0 && endIndex > beginIndex) {
    return `${current.slice(0, beginIndex)}${snippet.trimEnd()}\n${current.slice(endIndex + HAPPYTG_CADDY_END.length).replace(/^\s*/u, "")}`;
  }

  return `${current.trimEnd()}\n\n${snippet}`;
}

async function patchSystemCaddy(input: {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  caddyPath?: string;
  caddyfilePath?: string;
  runCommandImpl: typeof runCommand;
}): Promise<SystemCaddyPlan> {
  const commands: string[] = [];
  const warnings: string[] = [];
  const targetPath = input.caddyfilePath;
  if (!targetPath) {
    return {
      action: "patch-system",
      status: "blocked",
      detail: "Caddyfile patching requires an explicit Caddyfile path.",
      commands,
      warnings: ["No Caddyfile path was available for the requested patch."]
    };
  }

  if (!input.caddyPath) {
    return {
      action: "patch-system",
      status: "blocked",
      caddyfilePath: targetPath,
      detail: "Caddyfile patching requires the `caddy` binary so validation can run before reload.",
      commands,
      warnings: ["The `caddy` binary was not available."]
    };
  }

  const current = await readFile(targetPath, "utf8");
  const snippet = generateSystemCaddySnippet(input.env);
  const backupPath = `${targetPath}.happytg-backup-${Date.now()}`;
  await ensureDir(path.dirname(targetPath));
  await copyFile(targetPath, backupPath);
  await writeTextFileAtomic(targetPath, patchCaddyfileText(current, snippet));

  const validation = await runCaddyCommand({
    id: "caddy-validate",
    caddyPath: input.caddyPath,
    args: ["validate", "--config", targetPath],
    cwd: input.repoPath,
    env: input.env,
    platform: input.platform,
    commands,
    runCommandImpl: input.runCommandImpl
  });
  if (!validation.ok) {
    await copyFile(backupPath, targetPath);
    warnings.push(`Caddy validation failed after patch; restored backup ${backupPath}. Output: ${validation.output || "caddy validate failed."}`);
    return {
      action: "patch-system",
      status: "failed",
      caddyfilePath: targetPath,
      backupPath,
      detail: "Caddyfile patch was rolled back because validation failed.",
      commands,
      warnings
    };
  }

  const reload = await runCaddyCommand({
    id: "caddy-reload",
    caddyPath: input.caddyPath,
    args: ["reload", "--config", targetPath],
    cwd: input.repoPath,
    env: input.env,
    platform: input.platform,
    commands,
    runCommandImpl: input.runCommandImpl
  });
  if (!reload.ok) {
    warnings.push(`Caddy validation passed, but reload failed. Roll back with: copy ${backupPath} ${targetPath}. Output: ${reload.output || "caddy reload failed."}`);
    return {
      action: "patch-system",
      status: "failed",
      caddyfilePath: targetPath,
      backupPath,
      detail: "Caddyfile patch was written and validated, but reload failed.",
      commands,
      warnings
    };
  }

  return {
    action: "patch-system",
    status: "patched",
    caddyfilePath: targetPath,
    backupPath,
    detail: `Patched HappyTG-managed Caddy block in ${targetPath}, validated it, and reloaded Caddy.`,
    commands,
    warnings
  };
}

export async function buildSystemCaddyPlan(input: {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  action?: DockerCaddyAction;
  caddyfilePath?: string;
  patchConfirmed?: boolean;
  resolveExecutableImpl?: typeof resolveExecutable;
  runCommandImpl?: typeof runCommand;
}): Promise<SystemCaddyPlan> {
  if (input.action === "compose") {
    return {
      action: "compose",
      status: "compose",
      detail: "Docker Compose Caddy will be started as part of the isolated stack.",
      commands: [],
      warnings: []
    };
  }

  const resolveExecutableImpl = input.resolveExecutableImpl ?? resolveExecutable;
  const runCommandImpl = input.runCommandImpl ?? runCommand;
  const caddyPath = await resolveExecutableImpl("caddy", {
    cwd: input.repoPath,
    env: input.env,
    platform: input.platform
  });
  const existing = await detectExistingHappyTGCaddy({
    repoPath: input.repoPath,
    env: input.env,
    platform: input.platform,
    requestedPath: input.caddyfilePath,
    caddyPath,
    runCommandImpl
  });
  if (existing?.status === "reuse") {
    return existing;
  }

  if (input.action === "reuse-system") {
    return existing ?? {
      action: "reuse-system",
      status: "blocked",
      commands: [],
      warnings: ["System Caddy reuse was requested, but no validated HappyTG routes were found."],
      detail: "System Caddy reuse is blocked until the Caddyfile contains HappyTG routes and `caddy validate` passes."
    };
  }

  if (input.action === "skip") {
    return {
      action: "skip",
      status: "skipped",
      caddyfilePath: existing?.caddyfilePath,
      commands: existing?.commands ?? [],
      warnings: existing?.warnings ?? [],
      detail: "System Caddy setup was skipped; public Telegram Mini App and webhook HTTPS routes still need operator-owned reverse proxy configuration."
    };
  }

  if (input.action === "patch-system") {
    if (!input.patchConfirmed) {
      return {
        action: "patch-system",
        status: "blocked",
        caddyfilePath: input.caddyfilePath ?? existing?.caddyfilePath,
        commands: existing?.commands ?? [],
        warnings: ["Caddyfile patching was requested without the required second confirmation."],
        detail: "Caddyfile patching was blocked before mutating the operator-owned reverse proxy."
      };
    }

    return patchSystemCaddy({
      repoPath: input.repoPath,
      env: input.env,
      platform: input.platform,
      caddyPath,
      caddyfilePath: input.caddyfilePath ?? existing?.caddyfilePath,
      runCommandImpl
    });
  }

  const snippet = await writeSnippet({
    env: input.env,
    platform: input.platform
  });
  return {
    action: "print-snippet",
    status: "snippet",
    caddyfilePath: existing?.caddyfilePath,
    snippetPath: snippet.snippetPath,
    commands: existing?.commands ?? [],
    warnings: existing?.warnings ?? [],
    detail: `System Caddy routes were not changed. Review the HappyTG snippet at ${snippet.snippetPath}, then run \`caddy validate --config <Caddyfile>\` and \`caddy reload --config <Caddyfile>\` after applying it.`
  };
}

async function writeDockerReuseOverride(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  needsHostGateway: boolean;
}): Promise<string[]> {
  if (!input.needsHostGateway) {
    return [];
  }

  const overridePath = path.join(getLocalStateDir(input.env, input.platform), "state", "docker-compose.reuse.generated.yml");
  const serviceBlock = [
    "    extra_hosts:",
    "      - \"host.docker.internal:host-gateway\""
  ].join("\n");
  const content = [
    "services:",
    "  api:",
    serviceBlock,
    "  worker:",
    serviceBlock,
    ""
  ].join("\n");
  await writeTextFileAtomic(overridePath, content);
  return [overridePath];
}

export function recommendedDockerServiceStrategy(input: {
  repoEnv: NodeJS.ProcessEnv;
  detectedReusableServices?: readonly DockerServiceId[];
}): DockerServiceStrategy {
  return input.detectedReusableServices && input.detectedReusableServices.length > 0
    ? "reuse"
    : input.repoEnv.REDIS_URL || input.repoEnv.DATABASE_URL || input.repoEnv.S3_ENDPOINT
      ? "reuse"
      : "isolated";
}

export async function buildDockerServiceStrategyPlan(input: {
  strategy: DockerServiceStrategy;
  repoPath: string;
  repoEnv: NodeJS.ProcessEnv;
  installEnv: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  caddyAction?: DockerCaddyAction;
  caddyfilePath?: string;
  caddyPatchConfirmed?: boolean;
  resolveExecutableImpl?: typeof resolveExecutable;
  runCommandImpl?: typeof runCommand;
}): Promise<DockerServiceStrategyPlan> {
  if (input.strategy === "isolated") {
    return {
      strategy: "isolated",
      reusedServices: [],
      composeServices: [],
      env: {},
      overrideFiles: [],
      detail: "Isolated Docker stack selected; Compose will start HappyTG-owned Redis, Postgres, MinIO, and Caddy containers.",
      caddy: await buildSystemCaddyPlan({
        repoPath: input.repoPath,
        env: input.repoEnv,
        platform: input.platform,
        action: "compose",
        resolveExecutableImpl: input.resolveExecutableImpl,
        runCommandImpl: input.runCommandImpl
      })
    };
  }

  const env: Record<string, string> = {};
  let needsHostGateway = false;
  const redisUrl = translateEndpointForContainers({
    raw: input.repoEnv.REDIS_URL?.trim() || "redis://localhost:6379",
    platform: input.platform
  });
  env.COMPOSE_REDIS_URL = redisUrl.value;
  needsHostGateway ||= redisUrl.needsHostGateway;

  const databaseUrl = translateEndpointForContainers({
    raw: input.repoEnv.DATABASE_URL?.trim() || "postgres://postgres:postgres@localhost:5432/happytg",
    platform: input.platform
  });
  env.COMPOSE_DATABASE_URL = databaseUrl.value;
  needsHostGateway ||= databaseUrl.needsHostGateway;

  const s3Endpoint = translateEndpointForContainers({
    raw: input.repoEnv.S3_ENDPOINT?.trim() || "http://localhost:9000",
    platform: input.platform
  });
  env.COMPOSE_S3_ENDPOINT = s3Endpoint.value;
  needsHostGateway ||= s3Endpoint.needsHostGateway;

  const caddy = await buildSystemCaddyPlan({
    repoPath: input.repoPath,
    env: input.repoEnv,
    platform: input.platform,
    action: input.caddyAction,
    caddyfilePath: input.caddyfilePath,
    patchConfirmed: input.caddyPatchConfirmed,
    resolveExecutableImpl: input.resolveExecutableImpl,
    runCommandImpl: input.runCommandImpl
  });
  const caddyReused = caddy.status !== "compose";
  const overrideFiles = await writeDockerReuseOverride({
    env: input.installEnv,
    platform: input.platform,
    needsHostGateway
  });

  return {
    strategy: "reuse",
    reusedServices: caddyReused
      ? ["redis", "postgres", "minio", "caddy"]
      : ["redis", "postgres", "minio"],
    composeServices: caddyReused ? COMPOSE_APP_SERVICES : COMPOSE_APP_SERVICES_WITH_CADDY,
    env,
    overrideFiles,
    detail: caddyReused
      ? "Reuse existing system Redis/Postgres/MinIO/Caddy selected; Compose will start only HappyTG app/observability services."
      : "Reuse existing system Redis/Postgres/MinIO selected; Compose will still start HappyTG Caddy.",
    caddy
  };
}
