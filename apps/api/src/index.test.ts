import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";

import {
  createApiServer,
  formatApiPortConflictMessage,
  formatApiPortReuseMessage,
  startApiServer
} from "./index.js";

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
  setTimeout(() => {
    void closeServer(occupied);
  }, 10);

  try {
    const result = await startApiServer(apiServer, {
      port: address.port,
      logger: { info() {} },
      reuseProbeWindowMs: 50,
      reuseProbeIntervalMs: 10
    });

    assert.deepEqual(result, { status: "listening", port: address.port });
    assert.equal(apiServer.listening, true);
  } finally {
    if (apiServer.listening) {
      await closeServer(apiServer);
    }
  }
});
