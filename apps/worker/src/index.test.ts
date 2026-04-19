import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";

import { FileStateStore } from "../../../packages/shared/src/index.js";

import {
  createWorkerRuntime,
  createWorkerServer,
  formatWorkerPortConflictMessageDetailed,
  formatWorkerPortReuseMessage,
  startWorkerServer
} from "./index.js";

async function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("worker readiness becomes healthy after a successful tick", async () => {
  const runtime = createWorkerRuntime({
    store: new FileStateStore("/tmp/happytg-worker-ready-test.json"),
    tickMs: 50,
    readyMaxLagMs: 500
  });

  try {
    const before = runtime.readinessSnapshot();
    assert.equal(before.ok, false);

    await runtime.runTick();
    const after = runtime.readinessSnapshot();

    assert.equal(after.ok, true);
    assert.equal(after.service, "worker");
    assert.equal(after.lastTickStatus, "ok");
  } finally {
    runtime.stop();
  }
});

test("worker ready endpoint returns 503 before first tick", async () => {
  const runtime = createWorkerRuntime({
    store: new FileStateStore("/tmp/happytg-worker-server-test.json"),
    tickMs: 50,
    readyMaxLagMs: 500
  });
  const server = createWorkerServer(runtime);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Worker server did not bind to a TCP port");
  }

  try {
    const before = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const beforePayload = await before.json() as { ok: boolean; lastTickStatus: string };
    assert.equal(before.status, 503);
    assert.equal(beforePayload.ok, false);
    assert.equal(beforePayload.lastTickStatus, "idle");

    await runtime.runTick();

    const after = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const afterPayload = await after.json() as { ok: boolean; lastTickStatus: string };
    assert.equal(after.status, 200);
    assert.equal(afterPayload.ok, true);
    assert.equal(afterPayload.lastTickStatus, "ok");
  } finally {
    runtime.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("startWorkerServer listens and invokes onListening when the port is free", async () => {
  const server = createWorkerServer();
  let onListeningCalls = 0;
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];

  try {
    const result = await startWorkerServer(server, {
      port: 0,
      logger: {
        info(message, metadata) {
          infoLogs.push({ message, metadata });
        }
      },
      onListening() {
        onListeningCalls += 1;
      }
    });

    assert.equal(result.status, "listening");
    assert.equal(typeof result.port, "number");
    assert.equal(onListeningCalls, 1);
    assert.equal(infoLogs[0]?.message, "Worker probe server listening");
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
  }
});

test("startWorkerServer reuses an already-running HappyTG worker on the same port without starting local work", async () => {
  const occupied = createHttpServer((req, res) => {
    res.writeHead(req.url === "/ready" ? 503 : 200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: req.url !== "/ready", service: "worker" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied worker test server did not bind to a TCP port");
  }

  const server = createWorkerServer();
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  let onListeningCalls = 0;

  try {
    const result = await startWorkerServer(server, {
      port: address.port,
      logger: {
        info(message, metadata) {
          infoLogs.push({ message, metadata });
        }
      },
      reuseProbeWindowMs: 25,
      reuseProbeIntervalMs: 10,
      onListening() {
        onListeningCalls += 1;
      }
    });

    assert.deepEqual(result, { status: "reused", port: address.port });
    assert.equal(onListeningCalls, 0);
    assert.equal(infoLogs[0]?.message, formatWorkerPortReuseMessage(address.port));
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startWorkerServer rejects when a different HappyTG service occupies the worker port", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: true, service: "bot" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("HappyTG service test server did not bind to a TCP port");
  }

  const server = createWorkerServer();

  try {
    await assert.rejects(
      () => startWorkerServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatWorkerPortConflictMessageDetailed(address.port, { service: "bot" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startWorkerServer names a foreign HTTP listener when the port is occupied", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html"
    });
    res.end("<!doctype html><title>Contacts</title>");
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Foreign HTTP listener test server did not bind to a TCP port");
  }

  const server = createWorkerServer();

  try {
    await assert.rejects(
      () => startWorkerServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatWorkerPortConflictMessageDetailed(address.port, { description: "HTTP listener (Contacts)" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});
