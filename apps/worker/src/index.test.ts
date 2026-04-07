import assert from "node:assert/strict";
import test from "node:test";

import { FileStateStore } from "../../../packages/shared/src/index.js";

import { createWorkerRuntime, createWorkerServer } from "./index.js";

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
