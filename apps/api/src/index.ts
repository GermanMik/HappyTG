import { fileURLToPath } from "node:url";

import type {
  ClaimPairingRequest,
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
import { createJsonServer, createLogger, getControlPlaneStorePath, json, readJsonBody, route } from "../../../packages/shared/src/index.js";

import { HappyTGControlPlaneService } from "./service.js";

const logger = createLogger("api");

export function createApiServer(service = new HappyTGControlPlaneService()) {
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
      route("POST", "/api/v1/approvals/:id/resolve", async ({ req, res, params }) => {
        const body = await readJsonBody<ResolveApprovalRequest>(req);
        json(res, 200, await service.resolveApproval(params.id, body));
      }),
      route("GET", "/api/v1/miniapp/bootstrap", async ({ res, url }) => {
        json(res, 200, await service.getMiniAppOverview(url.searchParams.get("userId") ?? undefined));
      }),
      route("GET", "/api/v1/miniapp/session/:id/timeline", async ({ res, params }) => {
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
    logger
  );
}

const port = Number(process.env.PORT ?? 4000);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createApiServer();
  server.listen(port, () => {
    logger.info("API listening", { port });
  });
}
