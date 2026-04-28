import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";

import {
  createApiServer,
  formatApiPortConflictMessage,
  formatApiPortReuseMessage,
  startApiServer
} from "./index.js";
import { CodexDesktopControlError, HappyTGControlPlaneService } from "./service.js";

async function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("api ready endpoint returns store metadata", async () => {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; service: string; stateStorePath: string };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "api");
    assert.match(payload.stateStorePath, /control-plane\.json$/);
  } finally {
    await closeServer(server);
  }
});

test("api exposes fast version and prometheus metrics endpoints", async () => {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const versionResponse = await fetch(`http://127.0.0.1:${address.port}/version`);
    const version = await versionResponse.json() as { service: string; name: string };
    assert.equal(versionResponse.status, 200);
    assert.deepEqual({ service: version.service, name: version.name }, { service: "api", name: "HappyTG" });

    const metricsResponse = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    const metrics = await metricsResponse.text();
    assert.equal(metricsResponse.status, 200);
    assert.match(metrics, /happytg_service_up\{service="api"\} 1/);
  } finally {
    await closeServer(server);
  }
});

test("api dev CORS allows only explicit Mini App origins", async () => {
  const previousOrigins = process.env.HAPPYTG_DEV_CORS_ORIGINS;
  process.env.HAPPYTG_DEV_CORS_ORIGINS = "http://localhost:3001";

  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const allowed = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/dashboard`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3001"
      }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3001");

    const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/dashboard`, {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.test"
      }
    });
    assert.equal(denied.status, 403);
  } finally {
    await closeServer(server);
    if (previousOrigins === undefined) {
      delete process.env.HAPPYTG_DEV_CORS_ORIGINS;
    } else {
      process.env.HAPPYTG_DEV_CORS_ORIGINS = previousOrigins;
    }
  }
});

test("mini app projection endpoints require session auth instead of falling back to global state", async () => {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/dashboard`);
    const payload = await response.json() as { error: string };

    assert.equal(response.status, 401);
    assert.match(payload.error, /session auth required/i);
  } finally {
    await closeServer(server);
  }
});

test("mini app approval resolve endpoint uses bearer session user", async () => {
  const calls: Array<{ approvalId: string; userId: string; decision: string; scope?: string; nonce?: string }> = [];
  const service = {
    async resolveMiniAppUserId(token?: string) {
      return token === "mas_token" ? "usr_1" : undefined;
    },
    async resolveApproval(approvalId: string, input: { userId: string; decision: string; scope?: string; nonce?: string }) {
      calls.push({ approvalId, ...input });
      return {
        approval: { id: approvalId, state: "approved_once" },
        session: { id: "ses_1", state: "ready" },
        decision: { id: "apd_1" }
      };
    }
  } as unknown as HappyTGControlPlaneService;
  const server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/approvals/apr_1/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ decision: "approved", scope: "once" })
    });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/approvals/apr_1/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mas_token"
      },
      body: JSON.stringify({ decision: "approved", scope: "once", nonce: "apn_1" })
    });

    assert.equal(allowed.status, 200);
    assert.deepEqual(calls, [
      {
        approvalId: "apr_1",
        userId: "usr_1",
        decision: "approved",
        scope: "once",
        nonce: "apn_1"
      }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("mini app project and session mutation endpoints require bearer user context", async () => {
  const calls: Array<{ kind: string; userId?: string; body?: unknown }> = [];
  const service = {
    async resolveMiniAppUserId(token?: string) {
      return token === "mas_token" ? "usr_1" : undefined;
    },
    async listMiniAppProjects(userId?: string) {
      calls.push({ kind: "projects", userId });
      return {
        projects: [
          {
            id: "ws_1",
            hostId: "host_1",
            repoName: "HappyTG",
            path: "C:/Develop/Projects/HappyTG",
            activeSessions: 0,
            href: "/project/ws_1",
            newSessionHref: "/new-task?hostId=host_1&workspaceId=ws_1"
          }
        ]
      };
    },
    async createSession(body: unknown) {
      calls.push({ kind: "create", body });
      return {
        session: { id: "ses_1" }
      };
    },
    async getMiniAppSessionDetail(sessionId: string, userId?: string) {
      calls.push({ kind: "detail", userId, body: { sessionId } });
      return {
        session: {
          id: sessionId,
          title: "Mini App task",
          state: "ready",
          runtime: "codex-cli",
          lastUpdatedAt: "2026-04-22T04:00:00.000Z",
          href: `/session/${sessionId}`,
          nextAction: "open"
        },
        events: [],
        actions: []
      };
    }
  } as unknown as HappyTGControlPlaneService;
  const server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/projects`);
    assert.equal(denied.status, 401);

    const projects = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/projects`, {
      headers: {
        authorization: "Bearer mas_token"
      }
    });
    assert.equal(projects.status, 200);

    const created = await fetch(`http://127.0.0.1:${address.port}/api/v1/miniapp/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mas_token"
      },
      body: JSON.stringify({
        hostId: "host_1",
        workspaceId: "ws_1",
        mode: "proof",
        title: "Mini App task",
        prompt: "Run Codex"
      })
    });
    const payload = await created.json() as { session: { runtime: string; href: string } };

    assert.equal(created.status, 200);
    assert.equal(payload.session.runtime, "codex-cli");
    assert.equal(payload.session.href, "/session/ses_1");
    assert.deepEqual(calls.map((call) => call.kind), ["projects", "create", "detail"]);
    assert.deepEqual(calls[1]?.body, {
      hostId: "host_1",
      workspaceId: "ws_1",
      mode: "proof",
      title: "Mini App task",
      prompt: "Run Codex",
      userId: "usr_1",
      runtime: "codex-cli"
    });
  } finally {
    await closeServer(server);
  }
});

test("codex desktop API is user-scoped and maps guarded control responses", async () => {
  const calls: Array<{ kind: string; userId?: string; sessionId?: string; body?: unknown }> = [];
  const service = {
    async resolveMiniAppUserId(token?: string, userIdHint?: string) {
      return token === "mas_token" ? "usr_bearer" : userIdHint;
    },
    async listCodexDesktopProjects(userId: string) {
      calls.push({ kind: "projects", userId });
      return {
        projects: [
          {
            id: "cdp_1",
            label: "HappyTG",
            path: "C:/Develop/Projects/HappyTG",
            source: "codex-desktop"
          }
        ]
      };
    },
    async listCodexDesktopSessions(userId: string) {
      calls.push({ kind: "sessions", userId });
      return {
        sessions: [
          {
            id: "cds_1",
            title: "Desktop task",
            updatedAt: "2026-04-28T09:00:00.000Z",
            status: "recent",
            source: "codex-desktop",
            canResume: false,
            canStop: false,
            unsupportedReason: "contract missing"
          }
        ]
      };
    },
    async resumeCodexDesktopSession(userId: string, sessionId: string) {
      calls.push({ kind: "resume", userId, sessionId });
      throw new CodexDesktopControlError(501, "contract missing");
    },
    async stopCodexDesktopSession(userId: string, sessionId: string) {
      calls.push({ kind: "stop", userId, sessionId });
      throw new CodexDesktopControlError(501, "contract missing");
    },
    async createCodexDesktopTask(body: { userId: string; prompt: string; projectPath?: string }) {
      calls.push({ kind: "new-task", userId: body.userId, body });
      return {
        ok: true,
        action: "new-task",
        source: "codex-desktop",
        task: {
          id: "cdt_1",
          title: "Desktop task",
          projectPath: body.projectPath,
          status: "created"
        }
      };
    }
  } as unknown as HappyTGControlPlaneService;
  const server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/codex-desktop/projects`);
    assert.equal(denied.status, 401);

    const projects = await fetch(`http://127.0.0.1:${address.port}/api/v1/codex-desktop/projects?userId=usr_query`);
    const projectsPayload = await projects.json() as { projects: Array<{ source: string }> };
    assert.equal(projects.status, 200);
    assert.equal(projectsPayload.projects[0]?.source, "codex-desktop");

    const sessions = await fetch(`http://127.0.0.1:${address.port}/api/v1/codex-desktop/sessions`, {
      headers: {
        authorization: "Bearer mas_token"
      }
    });
    const sessionsPayload = await sessions.json() as { sessions: Array<{ source: string; unsupportedReason?: string }> };
    assert.equal(sessions.status, 200);
    assert.equal(sessionsPayload.sessions[0]?.source, "codex-desktop");
    assert.equal(sessionsPayload.sessions[0]?.unsupportedReason, "contract missing");

    const unsupported = await fetch(`http://127.0.0.1:${address.port}/api/v1/codex-desktop/sessions/cds_1/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ userId: "usr_query" })
    });
    const unsupportedPayload = await unsupported.json() as { source: string; reason: string };
    assert.equal(unsupported.status, 501);
    assert.equal(unsupportedPayload.source, "codex-desktop");
    assert.equal(unsupportedPayload.reason, "contract missing");

    const created = await fetch(`http://127.0.0.1:${address.port}/api/v1/codex-desktop/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mas_token"
      },
      body: JSON.stringify({ prompt: "Run Desktop task", projectPath: "C:/Develop/Projects/HappyTG" })
    });
    const createdPayload = await created.json() as { task: { id: string } };
    assert.equal(created.status, 200);
    assert.equal(createdPayload.task.id, "cdt_1");
    assert.deepEqual(calls.map((call) => `${call.kind}:${call.userId ?? ""}`), [
      "projects:usr_query",
      "sessions:usr_bearer",
      "resume:usr_query",
      "new-task:usr_bearer"
    ]);
  } finally {
    await closeServer(server);
  }
});

test("session cancel endpoint delegates to the control-plane service", async () => {
  const calls: string[] = [];
  const service = {
    async cancelSession(sessionId: string) {
      calls.push(sessionId);
      return {
        id: sessionId,
        state: "cancelled"
      };
    }
  } as unknown as HappyTGControlPlaneService;
  const server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/sessions/ses_1/cancel`, {
      method: "POST"
    });
    const payload = await response.json() as { id: string; state: string };

    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["ses_1"]);
    assert.deepEqual(payload, { id: "ses_1", state: "cancelled" });
  } finally {
    await closeServer(server);
  }
});

test("startApiServer reuses an already-running HappyTG API on the same port", async () => {
  const occupied = createHttpServer((req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    if (req.url === "/ready") {
      res.end(JSON.stringify({ ok: true, service: "api" }));
      return;
    }

    res.end(JSON.stringify({ ok: true, service: "api" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied API test server did not bind to a TCP port");
  }

  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const apiServer = createApiServer();

  try {
    const result = await startApiServer(apiServer, {
      port: address.port,
      logger: {
        info(message, metadata) {
          infoLogs.push({ message, metadata });
        }
      },
      reuseProbeWindowMs: 25,
      reuseProbeIntervalMs: 10
    });

    assert.deepEqual(result, { status: "reused", port: address.port });
    assert.equal(formatApiPortReuseMessage(address.port).includes("HAPPYTG_API_PORT/PORT"), true);
    assert.equal(infoLogs[0]?.message, formatApiPortReuseMessage(address.port));
  } finally {
    if (apiServer.listening) {
      await closeServer(apiServer);
    }
    await closeServer(occupied);
  }
});

test("startApiServer rejects with an actionable message when another process occupies the port", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/plain"
    });
    res.end("foreign");
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Foreign listener test server did not bind to a TCP port");
  }

  const apiServer = createApiServer();

  try {
    await assert.rejects(
      () => startApiServer(apiServer, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatApiPortConflictMessage(address.port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (apiServer.listening) {
      await closeServer(apiServer);
    }
    await closeServer(occupied);
  }
});

test("startApiServer rejects when a different HappyTG service occupies the API port", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: true, service: "miniapp" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("HappyTG service test server did not bind to a TCP port");
  }

  const apiServer = createApiServer();

  try {
    await assert.rejects(
      () => startApiServer(apiServer, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatApiPortConflictMessage(address.port, "miniapp").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (apiServer.listening) {
      await closeServer(apiServer);
    }
    await closeServer(occupied);
  }
});

test("startApiServer retries a transient HappyTG API handoff before classifying reuse", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: true, service: "api" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Transient handoff test server did not bind to a TCP port");
  }

  const apiServer = createApiServer();
  let occupiedClosed = false;
  setTimeout(() => {
    void closeServer(occupied).then(() => {
      occupiedClosed = true;
    });
  }, 20);

  try {
    const result = await startApiServer(apiServer, {
      port: address.port,
      logger: { info() {} },
      reuseProbeWindowMs: 250,
      reuseProbeIntervalMs: 25
    });

    assert.deepEqual(result, { status: "listening", port: address.port });
    assert.equal(apiServer.listening, true);
    assert.equal(occupiedClosed, true);
  } finally {
    if (apiServer.listening) {
      await closeServer(apiServer);
    }
    if (!occupiedClosed) {
      await closeServer(occupied);
    }
  }
});
