import type { AutomationItem } from "../finalization.js";

import type { CommandRunResult, runCommand } from "./commands.js";
import type {
  InstallLaunchCommandResult,
  InstallLaunchHealthCheck,
  InstallLaunchMode,
  InstallLaunchResult,
  InstallLaunchStatus,
  InstallStatus
} from "./types.js";

const COMPOSE_FILE = "infra/docker-compose.example.yml";
const DOCKER_COMPOSE_PREFIX = `docker compose --env-file .env -f ${COMPOSE_FILE}`;
const DOCKER_UP_COMMAND = `${DOCKER_COMPOSE_PREFIX} up --build -d`;
const DOCKER_CONFIG_COMMAND = `${DOCKER_COMPOSE_PREFIX} config`;
const DOCKER_PS_COMMAND = `${DOCKER_COMPOSE_PREFIX} ps`;
const DOCKER_PS_JSON_COMMAND = `${DOCKER_COMPOSE_PREFIX} ps --format json`;
const DEFAULT_HEALTH_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_INTERVAL_MS = 1_000;

interface ComposeServiceSummary {
  service: string;
  state?: string;
  health?: string;
  status?: string;
}

function commandOutput(result: Pick<CommandRunResult, "stdout" | "stderr">): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function commandResult(input: {
  id: string;
  command: string;
  result?: CommandRunResult;
  status?: "passed" | "failed" | "skipped";
  detail?: string;
}): InstallLaunchCommandResult {
  return {
    id: input.id,
    command: input.command,
    status: input.status ?? (input.result?.exitCode === 0 ? "passed" : "failed"),
    detail: input.detail ?? (commandOutput(input.result ?? { stdout: "", stderr: "" }) || "Command completed."),
    exitCode: input.result?.exitCode,
    stdout: input.result?.stdout,
    stderr: input.result?.stderr
  };
}

function outputIncludes(output: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(output));
}

function dockerFailureNextSteps(output: string, fallbackCommand: string): string[] {
  if (outputIncludes(output, [
    /cannot connect to the docker daemon/iu,
    /docker daemon is not running/iu,
    /error during connect/iu,
    /open \/\/\.\/pipe\/docker/iu,
    /is the docker daemon running/iu
  ])) {
    return [
      "Start Docker Desktop or the Docker daemon, then rerun `pnpm happytg install --launch-mode docker`.",
      "Verify Docker daemon access with `docker info`."
    ];
  }

  if (outputIncludes(output, [
    /unknown command.*compose/iu,
    /'compose' is not a docker command/iu,
    /compose is not a docker command/iu
  ])) {
    return [
      "Install Docker Compose v2 so `docker compose version` works.",
      "Then rerun `pnpm happytg install --launch-mode docker`."
    ];
  }

  if (outputIncludes(output, [
    /bind: address already in use/iu,
    /port is already allocated/iu,
    /ports are not available/iu
  ])) {
    return [
      "Free the reported port or set the matching HAPPYTG_*_PORT override in `.env`.",
      `Validate again with \`${DOCKER_CONFIG_COMMAND}\`, then start with \`${fallbackCommand}\`.`
    ];
  }

  return [
    `Inspect the Docker output, then rerun \`${fallbackCommand}\` from the checkout.`,
    "Rerun `pnpm happytg doctor --json` after the stack is reachable."
  ];
}

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function normalizeServiceName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseComposePsJson(stdout: string): ComposeServiceSummary[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parseItem = (value: unknown): ComposeServiceSummary | undefined => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const service = normalizeServiceName(record.Service ?? record.service ?? record.Name ?? record.name);
    if (!service) {
      return undefined;
    }

    return {
      service,
      state: typeof (record.State ?? record.state) === "string" ? String(record.State ?? record.state) : undefined,
      health: typeof (record.Health ?? record.health) === "string" ? String(record.Health ?? record.health) : undefined,
      status: typeof (record.Status ?? record.status) === "string" ? String(record.Status ?? record.status) : undefined
    };
  };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(parseItem).filter((item): item is ComposeServiceSummary => Boolean(item));
    }
    const single = parseItem(parsed);
    return single ? [single] : [];
  } catch {
    return trimmed
      .split(/\r?\n/u)
      .map((line) => {
        try {
          return parseItem(JSON.parse(line) as unknown);
        } catch {
          return undefined;
        }
      })
      .filter((item): item is ComposeServiceSummary => Boolean(item));
  }
}

function serviceSummary(services: readonly ComposeServiceSummary[], service: string): ComposeServiceSummary | undefined {
  return services.find((item) => item.service === service.toLowerCase());
}

function composeHealthCheck(services: readonly ComposeServiceSummary[], service: string, label: string): InstallLaunchHealthCheck {
  const summary = serviceSummary(services, service);
  if (!summary) {
    return {
      id: service,
      label,
      status: "warn",
      detail: `${label} was not present in Docker Compose ps output. Run \`${DOCKER_PS_COMMAND}\` to inspect the stack.`
    };
  }

  const state = (summary.state ?? "").toLowerCase();
  const health = (summary.health ?? "").toLowerCase();
  const status = (summary.status ?? "").toLowerCase();
  if (health === "healthy") {
    return {
      id: service,
      label,
      status: "pass",
      detail: `${label} Compose health is healthy.`
    };
  }
  if (health && health !== "healthy") {
    return {
      id: service,
      label,
      status: health === "starting" ? "warn" : "fail",
      detail: `${label} Compose health is ${summary.health}.`
    };
  }
  if (state === "running" || status.includes("up")) {
    return {
      id: service,
      label,
      status: "warn",
      detail: `${label} is running, but Compose did not report a health state.`
    };
  }

  return {
    id: service,
    label,
    status: "fail",
    detail: `${label} is not running according to Compose ps${summary.state ? ` (${summary.state})` : ""}.`
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchReady(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<{ ok: boolean; detail: string }> {
  const startedAt = Date.now();
  let lastDetail = "readiness endpoint did not respond yet.";

  while (Date.now() - startedAt <= input.timeoutMs) {
    const remaining = Math.max(1, input.timeoutMs - (Date.now() - startedAt));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(2_000, remaining));
    try {
      const response = await input.fetchImpl(input.url, {
        signal: controller.signal
      });
      if (response.ok) {
        clearTimeout(timeout);
        return {
          ok: true,
          detail: `Ready endpoint responded with HTTP ${response.status}.`
        };
      }
      lastDetail = `Ready endpoint responded with HTTP ${response.status}.`;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : "readiness request failed.";
    } finally {
      clearTimeout(timeout);
    }

    if (Date.now() - startedAt >= input.timeoutMs) {
      break;
    }
    await sleep(Math.min(input.intervalMs, Math.max(1, input.timeoutMs - (Date.now() - startedAt))));
  }

  return {
    ok: false,
    detail: lastDetail
  };
}

async function httpHealthCheck(input: {
  id: string;
  label: string;
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  intervalMs: number;
}): Promise<InstallLaunchHealthCheck> {
  const result = await fetchReady({
    fetchImpl: input.fetchImpl,
    url: input.url,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs
  });

  return {
    id: input.id,
    label: input.label,
    status: result.ok ? "pass" : "fail",
    detail: result.detail,
    url: input.url
  };
}

function launchStatusFromHealth(health: readonly InstallLaunchHealthCheck[]): InstallLaunchStatus {
  return health.some((item) => item.status === "fail") ? "failed" : "started";
}

function launchDetailFromHealth(status: InstallLaunchStatus, health: readonly InstallLaunchHealthCheck[]): string {
  if (status === "started") {
    return "Docker Compose control-plane stack started. Host daemon still runs outside Docker.";
  }

  const failed = health.filter((item) => item.status === "fail");
  return `Docker Compose started, but ${failed.length} health check${failed.length === 1 ? "" : "s"} still need attention.`;
}

export function createStaticLaunchResult(mode: InstallLaunchMode): InstallLaunchResult {
  switch (mode) {
    case "manual":
      return {
        mode,
        status: "not-started",
        detail: "Manual launch mode selected; installer did not start local services or containers.",
        commands: [],
        health: [],
        warnings: [],
        nextSteps: [
          "For local development, run `pnpm dev`.",
          `For packaged Docker startup, run \`${DOCKER_UP_COMMAND}\`.`
        ]
      };
    case "skip":
      return {
        mode,
        status: "skipped",
        detail: "Startup action was skipped.",
        commands: [],
        health: [],
        warnings: [],
        nextSteps: []
      };
    case "local":
    default:
      return {
        mode: "local",
        status: "not-started",
        detail: "Local dev launch mode selected; installer did not start containers.",
        commands: [],
        health: [],
        warnings: [],
        nextSteps: [
          "Start local repo services with `pnpm dev`."
        ]
      };
  }
}

export function launchAutomationItems(launch: InstallLaunchResult): AutomationItem[] {
  if (launch.mode === "local") {
    return [
      {
        id: "start-repo-services",
        kind: "manual",
        message: "Start local repo services: `pnpm dev`."
      }
    ];
  }

  if (launch.mode === "manual") {
    return [
      {
        id: "start-repo-services",
        kind: "manual",
        message: "Start the control-plane manually after reviewing ports.",
        solutions: [
          "Local dev: `pnpm dev`.",
          `Docker Compose: \`${DOCKER_UP_COMMAND}\`.`
        ]
      }
    ];
  }

  if (launch.mode !== "docker") {
    return [];
  }

  const hostDaemonMessage = "The host daemon is not part of Docker Compose; pair/start it on the host with `pnpm daemon:pair` and `pnpm dev:daemon` or the configured host launcher.";
  if (launch.status === "started") {
    return [
      {
        id: "start-repo-services",
        kind: "auto",
        message: `Started the packaged control-plane stack: \`${launch.command ?? DOCKER_UP_COMMAND}\`.`
      },
      {
        id: "host-daemon-outside-compose",
        kind: "manual",
        message: hostDaemonMessage
      }
    ];
  }

  return [
    {
      id: "start-repo-services",
      kind: "blocked",
      message: `Docker Compose launch did not complete: ${launch.detail}`,
      solutions: launch.nextSteps
    },
    {
      id: "host-daemon-outside-compose",
      kind: "manual",
      message: hostDaemonMessage
    }
  ];
}

export async function runDockerLaunch(input: {
  repoPath: string;
  repoEnv: NodeJS.ProcessEnv;
  installEnv: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
  resolveExecutableImpl: (command: string, input?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }) => Promise<string | undefined>;
  runCommandImpl: typeof runCommand;
}): Promise<InstallLaunchResult> {
  const commands: InstallLaunchCommandResult[] = [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const healthTimeoutMs = input.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const healthIntervalMs = input.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const dockerPath = await input.resolveExecutableImpl("docker", {
    cwd: input.repoPath,
    env: input.installEnv,
    platform: input.platform
  });

  if (!dockerPath) {
    return {
      mode: "docker",
      status: "failed",
      composeFile: COMPOSE_FILE,
      command: DOCKER_UP_COMMAND,
      commands,
      health: [],
      detail: "Docker binary was not found in this shell.",
      warnings: ["Docker launch was requested, but Docker is not installed or not on PATH."],
      nextSteps: [
        "Install Docker Desktop or Docker Engine with Compose v2.",
        "Verify `docker --version` and `docker compose version`, then rerun `pnpm happytg install --launch-mode docker`."
      ]
    };
  }

  const runDocker = async (id: string, displayCommand: string, args: string[]): Promise<CommandRunResult> => {
    const result = await input.runCommandImpl({
      command: dockerPath,
      args,
      cwd: input.repoPath,
      env: input.installEnv,
      platform: input.platform
    }).catch((error) => ({
      stdout: "",
      stderr: error instanceof Error ? error.message : "Docker command failed to start.",
      exitCode: 1,
      binaryPath: dockerPath,
      shell: false,
      fallbackUsed: false
    }));
    commands.push(commandResult({
      id,
      command: displayCommand,
      result
    }));
    return result;
  };

  const composeVersion = await runDocker("compose-version", "docker compose version", ["compose", "version"]);
  if (composeVersion.exitCode !== 0) {
    const output = commandOutput(composeVersion);
    return {
      mode: "docker",
      status: "failed",
      composeFile: COMPOSE_FILE,
      command: DOCKER_UP_COMMAND,
      commands,
      health: [],
      detail: "Docker Compose v2 is unavailable.",
      warnings: [output || "Docker Compose v2 check failed."],
      nextSteps: dockerFailureNextSteps(output, DOCKER_UP_COMMAND)
    };
  }

  const dockerInfo = await runDocker("docker-info", "docker info", ["info"]);
  if (dockerInfo.exitCode !== 0) {
    const output = commandOutput(dockerInfo);
    return {
      mode: "docker",
      status: "failed",
      composeFile: COMPOSE_FILE,
      command: DOCKER_UP_COMMAND,
      commands,
      health: [],
      detail: "Docker is installed, but the Docker daemon/Desktop is unavailable.",
      warnings: [output || "Docker daemon/Desktop check failed."],
      nextSteps: dockerFailureNextSteps(output, DOCKER_UP_COMMAND)
    };
  }

  const config = await runDocker("compose-config", DOCKER_CONFIG_COMMAND, ["compose", "--env-file", ".env", "-f", COMPOSE_FILE, "config"]);
  if (config.exitCode !== 0) {
    const output = commandOutput(config);
    return {
      mode: "docker",
      status: "failed",
      composeFile: COMPOSE_FILE,
      command: DOCKER_UP_COMMAND,
      commands,
      health: [],
      detail: "Docker Compose config validation failed.",
      warnings: [output || "Compose config validation failed."],
      nextSteps: dockerFailureNextSteps(output, DOCKER_UP_COMMAND)
    };
  }

  const up = await runDocker("compose-up", DOCKER_UP_COMMAND, ["compose", "--env-file", ".env", "-f", COMPOSE_FILE, "up", "--build", "-d"]);
  if (up.exitCode !== 0) {
    const output = commandOutput(up);
    return {
      mode: "docker",
      status: "failed",
      composeFile: COMPOSE_FILE,
      command: DOCKER_UP_COMMAND,
      commands,
      health: [],
      detail: "Docker Compose startup failed.",
      warnings: [output || "Compose startup failed."],
      nextSteps: dockerFailureNextSteps(output, DOCKER_UP_COMMAND)
    };
  }

  const psJson = await runDocker("compose-ps-json", DOCKER_PS_JSON_COMMAND, ["compose", "--env-file", ".env", "-f", COMPOSE_FILE, "ps", "--format", "json"]);
  let services: ComposeServiceSummary[] = [];
  if (psJson.exitCode === 0) {
    services = parseComposePsJson(psJson.stdout);
  } else {
    await runDocker("compose-ps", DOCKER_PS_COMMAND, ["compose", "--env-file", ".env", "-f", COMPOSE_FILE, "ps"]);
  }

  const health: InstallLaunchHealthCheck[] = [
    await httpHealthCheck({
      id: "api",
      label: "API",
      url: `http://127.0.0.1:${readPort(input.repoEnv, "HAPPYTG_API_PORT", 4000)}/ready`,
      fetchImpl,
      timeoutMs: healthTimeoutMs,
      intervalMs: healthIntervalMs
    }),
    await httpHealthCheck({
      id: "bot",
      label: "Bot",
      url: `http://127.0.0.1:${readPort(input.repoEnv, "HAPPYTG_BOT_PORT", 4100)}/ready`,
      fetchImpl,
      timeoutMs: healthTimeoutMs,
      intervalMs: healthIntervalMs
    }),
    await httpHealthCheck({
      id: "miniapp",
      label: "Mini App",
      url: `http://127.0.0.1:${readPort(input.repoEnv, "HAPPYTG_MINIAPP_PORT", 3001)}/ready`,
      fetchImpl,
      timeoutMs: healthTimeoutMs,
      intervalMs: healthIntervalMs
    }),
    composeHealthCheck(services, "worker", "Worker")
  ];
  const status = launchStatusFromHealth(health);
  const failedHealth = health.filter((item) => item.status === "fail");
  return {
    mode: "docker",
    status,
    composeFile: COMPOSE_FILE,
    command: DOCKER_UP_COMMAND,
    commands,
    health,
    detail: launchDetailFromHealth(status, health),
    warnings: failedHealth.map((item) => `${item.label}: ${item.detail}`),
    nextSteps: failedHealth.length > 0
      ? [
        `Inspect the stack with \`${DOCKER_PS_COMMAND}\`.`,
        "Review service logs with `docker compose --env-file .env -f infra/docker-compose.example.yml logs <service>`.",
        "Rerun `pnpm happytg doctor --json` after the readiness checks pass."
      ]
      : [
        `Inspect the running stack with \`${DOCKER_PS_COMMAND}\`.`
      ]
  };
}

export function launchStepStatus(launch: InstallLaunchResult): "passed" | "warn" | "failed" | "skipped" {
  if (launch.mode === "docker") {
    if (launch.status === "started") {
      return launch.health.some((item) => item.status === "warn") ? "warn" : "passed";
    }
    return "failed";
  }

  return "skipped";
}

export function launchOverallStatus(launch: InstallLaunchResult): InstallStatus {
  if (launch.status === "failed") {
    return "fail";
  }
  if (launch.health.some((item) => item.status === "warn")) {
    return "warn";
  }
  return "pass";
}
