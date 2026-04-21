import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";

import {
  createApiServer,
  formatApiPortConflictMessage,
  formatApiPortReuseMessage,
  startApiServer
} from "./index.js";
import { HappyTGControlPlaneService } from "./service.js";

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
