import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

import type {
  ClaimPairingRequest,
  CreateMiniAppLaunchGrantRequest,
  CreateMiniAppSessionRequest,
  CreatePairingRequest,
  CreateSessionRequest,
  DaemonCompleteRequest,
  DaemonDispatchAckRequest,
  DaemonSessionEventRequest,
  DaemonTaskPhaseRequest,
  HostHelloRequest,
  HostHeartbeatRequest,
  HostPollRequest,
  ResolveApprovalRequest
} from "../../../packages/protocol/src/index.js";
import {
  createJsonServer,
  createDevCorsOptions,
  createLogger,
  getControlPlaneStorePath,
  json,
  loadHappyTGEnv,
  readJsonBody,
  readPort,
  renderPrometheusMetrics,
  route,
  text,
  type Logger
} from "../../../packages/shared/src/index.js";

import { HappyTGControlPlaneService } from "./service.js";

const logger = createLogger("api");
loadHappyTGEnv();
const port = readPort(process.env, ["HAPPYTG_API_PORT", "PORT"], 4000);

export function createApiServer(service = new HappyTGControlPlaneService()) {
  type MiniAppRequest = { headers: Record<string, string | string[] | undefined> };

  function miniAppBearerToken(req: MiniAppRequest): string | undefined {
    const authorization = req.headers.authorization;
    return typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice("bearer ".length).trim()
      : undefined;
  }

  async function miniAppUserId(req: MiniAppRequest, url: URL): Promise<string | undefined> {
    return service.resolveMiniAppUserId(miniAppBearerToken(req), url.searchParams.get("userId") ?? undefined);
  }

  async function requireMiniAppUserId(req: MiniAppRequest, res: ServerResponse, url: URL): Promise<string | undefined> {
    const userId = await miniAppUserId(req, url);
    if (!userId) {
      json(res, 401, { error: "Mini App session auth required" });
      return undefined;
    }

    return userId;
  }

  async function withRequiredMiniAppUser<T>(
    req: MiniAppRequest,
    res: ServerResponse,
    url: URL,
    handler: (userId: string) => Promise<T>
  ): Promise<void> {
    const userId = await requireMiniAppUserId(req, res, url);
    if (!userId) {
      return;
    }

    json(res, 200, await handler(userId));
  }

  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        json(res, 200, { ok: true, service: "api" });
      }),
      route("GET", "/ready", async ({ res }) => {
        json(res, 200, {
          ok: true,
          service: "api",
          stateStorePath: getControlPlaneStorePath()
        });
      }),
      route("GET", "/version", async ({ res }) => {
        json(res, 200, {
          service: "api",
          name: "HappyTG",
          version: process.env.npm_package_version ?? "0.4.0"
        });
      }),
      route("GET", "/metrics", async ({ res }) => {
        text(res, 200, renderPrometheusMetrics("api"));
      }),
      route("POST", "/api/v1/pairing/start", async ({ req, res }) => {
        const body = await readJsonBody<CreatePairingRequest>(req);
        json(res, 200, await service.startPairing(body));
      }),
      route("POST", "/api/v1/pairing/claim", async ({ req, res }) => {
        const body = await readJsonBody<ClaimPairingRequest>(req);
        json(res, 200, await service.claimPairing(body));
      }),
      route("GET", "/api/v1/hosts", async ({ res, url }) => {
        json(res, 200, { hosts: await service.listHosts(url.searchParams.get("userId") ?? undefined) });
      }),
      route("GET", "/api/v1/hosts/:id/workspaces", async ({ res, params, url }) => {
        json(res, 200, {
          workspaces: await service.listWorkspaces(params.id, url.searchParams.get("userId") ?? undefined)
        });
      }),
      route("POST", "/api/v1/hosts/:id/bootstrap/:command", async ({ req, res, params }) => {
        const body = await readJsonBody<{ userId: string }>(req);
        if (params.command !== "doctor" && params.command !== "verify") {
          json(res, 400, { error: "Unsupported bootstrap command" });
          return;
        }

        json(res, 200, await service.createBootstrapSession({
          userId: body.userId,
          hostId: params.id,
          command: params.command
        }));
      }),
      route("GET", "/api/v1/users/by-telegram/:telegramUserId", async ({ res, params }) => {
        const user = await service.getUserByTelegram(params.telegramUserId);
        if (!user) {
          json(res, 404, { error: "User not found for telegram identity" });
          return;
        }

        json(res, 200, user);
      }),
      route("POST", "/api/v1/sessions", async ({ req, res }) => {
        const body = await readJsonBody<CreateSessionRequest>(req);
        json(res, 200, await service.createSession(body));
      }),
      route("GET", "/api/v1/sessions", async ({ res, url }) => {
        json(res, 200, { sessions: await service.listSessions(url.searchParams.get("userId") ?? undefined) });
      }),
      route("GET", "/api/v1/sessions/:id", async ({ res, params }) => {
        const session = await service.getSession(params.id);
        if (!session) {
          json(res, 404, { error: "Session not found" });
          return;
        }

        json(res, 200, session);
      }),
      route("POST", "/api/v1/sessions/:id/resume", async ({ res, params }) => {
        json(res, 200, await service.resumeSession(params.id));
      }),
      route("GET", "/api/v1/tasks/:id", async ({ res, params }) => {
        const task = await service.getTask(params.id);
        if (!task) {
          json(res, 404, { error: "Task not found" });
          return;
        }

        json(res, 200, task);
      }),
      route("GET", "/api/v1/tasks/:id/artifacts", async ({ res, params }) => {
        json(res, 200, await service.listTaskArtifacts(params.id));
      }),
      route("GET", "/api/v1/tasks/:id/artifact", async ({ res, params, url }) => {
        const relativePath = url.searchParams.get("path");
        if (!relativePath) {
          json(res, 400, { error: "Missing artifact path" });
          return;
        }

        json(res, 200, await service.readTaskArtifact(params.id, relativePath));
      }),
      route("GET", "/api/v1/approvals/:id", async ({ res, params }) => {
        const approval = await service.getApproval(params.id);
        if (!approval) {
          json(res, 404, { error: "Approval not found" });
          return;
        }

        json(res, 200, approval);
      }),
      route("GET", "/api/v1/approvals", async ({ res, url }) => {
        const states = url.searchParams.get("state")?.split(",").map((item) => item.trim()).filter(Boolean);
        json(res, 200, {
          approvals: await service.listApprovals(url.searchParams.get("userId") ?? undefined, states)
        });
      }),
      route("POST", "/api/v1/approvals/:id/resolve", async ({ req, res, params }) => {
        const body = await readJsonBody<ResolveApprovalRequest>(req);
        json(res, 200, await service.resolveApproval(params.id, body));
      }),
      route("GET", "/api/v1/miniapp/bootstrap", async ({ res, url }) => {
        json(res, 200, await service.getMiniAppOverview(url.searchParams.get("userId") ?? undefined));
      }),
      route("POST", "/api/v1/miniapp/launch-grants", async ({ req, res }) => {
        const body = await readJsonBody<CreateMiniAppLaunchGrantRequest>(req);
        json(res, 200, await service.createMiniAppLaunchGrant(body));
      }),
      route("POST", "/api/v1/miniapp/launch-grants/:id/revoke", async ({ req, res, params }) => {
        const body = await readJsonBody<{ userId?: string }>(req);
        json(res, 200, { grant: await service.revokeMiniAppLaunchGrant(params.id, body.userId) });
      }),
      route("POST", "/api/v1/miniapp/auth/session", async ({ req, res }) => {
        try {
          const body = await readJsonBody<CreateMiniAppSessionRequest>(req);
          json(res, 200, await service.createMiniAppSession(body));
        } catch (error) {
          json(res, 401, {
            error: "Mini App auth failed",
            detail: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }),
      route("POST", "/api/v1/miniapp/auth/session/:id/revoke", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, async (userId) => ({
          appSession: await service.revokeMiniAppSession(params.id, userId)
        }));
      }),
      route("GET", "/api/v1/miniapp/dashboard", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppDashboard(userId));
      }),
      route("GET", "/api/v1/miniapp/sessions", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.listMiniAppSessions(userId));
      }),
      route("POST", "/api/v1/miniapp/sessions", async ({ req, res, url }) => {
        const userId = await requireMiniAppUserId(req, res, url);
        if (!userId) {
          return;
        }

        const body = await readJsonBody<Omit<CreateSessionRequest, "userId" | "runtime"> & { runtime?: CreateSessionRequest["runtime"] }>(req);
        const created = await service.createSession({
          ...body,
          userId,
          runtime: "codex-cli"
        });
        const detail = await service.getMiniAppSessionDetail(created.session.id, userId);
        json(res, 200, {
          ...created,
          session: detail.session
        });
      }),
      route("GET", "/api/v1/miniapp/sessions/:id", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppSessionDetail(params.id, userId));
      }),
      route("GET", "/api/v1/miniapp/sessions/:id/diff", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppDiffSummary(params.id, userId));
      }),
      route("GET", "/api/v1/miniapp/sessions/:id/verify", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppVerifySummary(params.id, userId));
      }),
      route("GET", "/api/v1/miniapp/approvals", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.listMiniAppApprovals(userId));
      }),
      route("GET", "/api/v1/miniapp/approvals/:id", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppApprovalDetail(params.id, userId));
      }),
      route("POST", "/api/v1/miniapp/approvals/:id/resolve", async ({ req, res, params, url }) => {
        const userId = await requireMiniAppUserId(req, res, url);
        if (!userId) {
          return;
        }

        const body = await readJsonBody<Omit<ResolveApprovalRequest, "userId">>(req);
        json(res, 200, await service.resolveApproval(params.id, {
          ...body,
          userId
        }));
      }),
      route("GET", "/api/v1/miniapp/hosts", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.listMiniAppHosts(userId));
      }),
      route("GET", "/api/v1/miniapp/projects", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.listMiniAppProjects(userId));
      }),
      route("GET", "/api/v1/miniapp/hosts/:id", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppHostDetail(params.id, userId));
      }),
      route("GET", "/api/v1/miniapp/reports", async ({ req, res, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.listMiniAppReports(userId));
      }),
      route("GET", "/api/v1/miniapp/tasks/:id/bundle", async ({ req, res, params, url }) => {
        await withRequiredMiniAppUser(req, res, url, (userId) => service.getMiniAppBundleDetail(params.id, userId));
      }),
      route("GET", "/api/v1/miniapp/session/:id/timeline", async ({ req, res, params, url }) => {
        const userId = await requireMiniAppUserId(req, res, url);
        if (!userId) {
          return;
        }

        await service.getMiniAppSessionDetail(params.id, userId);
        json(res, 200, await service.getSessionTimeline(params.id));
      }),
      route("POST", "/api/v1/daemon/hello", async ({ req, res }) => {
        const body = await readJsonBody<HostHelloRequest>(req);
        json(res, 200, await service.hostHello(body));
      }),
      route("POST", "/api/v1/daemon/heartbeat", async ({ req, res }) => {
        const body = await readJsonBody<HostHeartbeatRequest>(req);
        json(res, 200, await service.hostHeartbeat(body.hostId));
      }),
      route("POST", "/api/v1/daemon/poll", async ({ req, res }) => {
        const body = await readJsonBody<HostPollRequest>(req);
        json(res, 200, await service.hostPoll(body));
      }),
      route("POST", "/api/v1/daemon/dispatch/ack", async ({ req, res }) => {
        const body = await readJsonBody<DaemonDispatchAckRequest>(req);
        json(res, 200, await service.ackDispatch(body));
      }),
      route("POST", "/api/v1/daemon/session/event", async ({ req, res }) => {
        const body = await readJsonBody<DaemonSessionEventRequest>(req);
        json(res, 200, await service.updateSessionFromDaemon(body));
      }),
      route("POST", "/api/v1/daemon/task/phase", async ({ req, res }) => {
        const body = await readJsonBody<DaemonTaskPhaseRequest>(req);
        json(res, 200, await service.updateTaskPhase(body.taskId, body.phase, body.verificationState));
      }),
      route("POST", "/api/v1/daemon/session/complete", async ({ req, res }) => {
        const body = await readJsonBody<DaemonCompleteRequest>(req);
        json(res, 200, await service.completeDispatch(body));
      })
    ],
    logger,
    {
      cors: createDevCorsOptions()
    }
  );
}

export function formatApiPortReuseMessage(listenPort: number): string {
  return `Port ${listenPort} already has a HappyTG API. Reuse the running API if it is yours, or start a new one with HAPPYTG_API_PORT/PORT, then try again.`;
}

export function formatApiPortConflictMessage(listenPort: number, service?: string): string {
  if (service) {
    return `Port ${listenPort} is already in use by HappyTG ${service}, not HappyTG API. Free it, or start the API with HAPPYTG_API_PORT/PORT, then try again.`;
  }

  return `Port ${listenPort} is already in use by another process. Free it, or start the API with HAPPYTG_API_PORT/PORT, then try again.`;
}

export interface ApiStartupResult {
  status: "listening" | "reused";
  port: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function detectHappyTGServiceOnPort(listenPort: number, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  for (const pathname of ["/ready", "/health"]) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${listenPort}${pathname}`, {
        signal: AbortSignal.timeout(750)
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        continue;
      }

      const payload = await response.json() as { service?: string };
      if (payload.service) {
        return payload.service;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function startApiServer(
  server = createApiServer(),
  options?: {
    port?: number;
    logger?: Pick<Logger, "info">;
    fetchImpl?: typeof fetch;
    reuseProbeWindowMs?: number;
    reuseProbeIntervalMs?: number;
  }
): Promise<ApiStartupResult> {
  const listenPort = options?.port ?? port;
  const activeLogger = options?.logger ?? logger;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const reuseProbeWindowMs = options?.reuseProbeWindowMs ?? 2_000;
  const reuseProbeIntervalMs = options?.reuseProbeIntervalMs ?? Math.min(100, reuseProbeWindowMs);

  async function listenOnce(): Promise<"listening" | "in_use"> {
    return await new Promise<"listening" | "in_use">((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve("listening");
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EADDRINUSE") {
          resolve("in_use");
          return;
        }

        reject(error);
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(listenPort);
    });
  }

  if (await listenOnce() === "listening") {
    activeLogger.info("API listening", { port: listenPort });
    return { status: "listening", port: listenPort };
  }

  const service = await detectHappyTGServiceOnPort(listenPort, fetchImpl);
  if (service !== "api") {
    throw new Error(formatApiPortConflictMessage(listenPort, service));
  }

  if (reuseProbeWindowMs > 0) {
    for (let waitedMs = 0; waitedMs < reuseProbeWindowMs; waitedMs += reuseProbeIntervalMs) {
      await delay(reuseProbeIntervalMs);
      const serviceAfterDelay = await detectHappyTGServiceOnPort(listenPort, fetchImpl);
      if (!serviceAfterDelay) {
        if (await listenOnce() === "listening") {
          activeLogger.info("API listening", { port: listenPort });
          return { status: "listening", port: listenPort };
        }

        const retryService = await detectHappyTGServiceOnPort(listenPort, fetchImpl);
        if (!retryService) {
          continue;
        }

        if (retryService !== "api") {
          throw new Error(formatApiPortConflictMessage(listenPort, retryService));
        }
        continue;
      }

      if (serviceAfterDelay !== "api") {
        throw new Error(formatApiPortConflictMessage(listenPort, serviceAfterDelay));
      }
    }
  }

  const finalService = await detectHappyTGServiceOnPort(listenPort, fetchImpl);
  if (finalService !== "api") {
    throw new Error(formatApiPortConflictMessage(listenPort, finalService));
  }

  activeLogger.info(formatApiPortReuseMessage(listenPort), { port: listenPort });
  return { status: "reused", port: listenPort };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createApiServer();
  void startApiServer(server).catch((error) => {
    console.error(error instanceof Error ? error.message : "API failed to start.");
    process.exitCode = 1;
  });
}
