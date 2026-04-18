import assert from "node:assert/strict";
import { createServer, createServer as createHttpServer } from "node:http";
import test from "node:test";

import {
  createMiniAppServer,
  formatMiniAppPortConflictMessage,
  formatMiniAppPortConflictMessageDetailed,
  formatMiniAppPortReuseMessage,
  startMiniAppServer
} from "./index.js";

async function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("mini app ready endpoint returns 503 when api health fails", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      assert.equal(pathname, "/health");
      throw new Error("api unavailable");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mini App server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; detail: string };

    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.match(payload.detail, /api unavailable/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("overview page renders hosts, sessions, approvals, and tasks", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_1") {
        return {
          hosts: [{ id: "host_1", label: "devbox", status: "active" }],
          sessions: [{ id: "ses_1", title: "Quick fix", state: "completed", taskId: "HTG-0001" }],
          approvals: [{ id: "apr_1", sessionId: "ses_1", state: "approved", reason: "workspace write" }],
          tasks: [{ id: "HTG-0001", phase: "complete", verificationState: "passed" }]
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mini App server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/?userId=usr_1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /HappyTG Mini App/);
    assert.match(html, /devbox/);
    assert.match(html, /badge badge-success">active/);
    assert.match(html, /href="\/session\/ses_1"/);
    assert.match(html, /href="\/task\/HTG-0001"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("task page renders canonical artifacts and escapes file content", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/tasks/HTG-0001") {
        return {
          task: {
            id: "HTG-0001",
            rootPath: "/repo/.agent/tasks/HTG-0001",
            phase: "verify",
            verificationState: "failed"
          },
          validation: {
            ok: false,
            missing: ["raw/test-unit.txt"]
          }
        } as never;
      }
      if (pathname === "/api/v1/tasks/HTG-0001/artifacts") {
        return {
          artifacts: ["/repo/.agent/tasks/HTG-0001/spec.md", "/repo/.agent/tasks/HTG-0001/verdict.json"]
        } as never;
      }
      if (pathname.startsWith("/api/v1/tasks/HTG-0001/artifact?path=")) {
        return {
          path: pathname,
          content: "<unsafe>content</unsafe>"
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mini App server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/task/HTG-0001`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Task HTG-0001/);
    assert.match(html, /Proof Progress/);
    assert.match(html, /Fresh Verify/);
    assert.match(html, /missing raw\/test-unit.txt/);
    assert.match(html, /&lt;unsafe&gt;content&lt;\/unsafe&gt;/);
    assert.doesNotMatch(html, /<unsafe>content<\/unsafe>/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("session page renders timeline, summary, and task link", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/session/ses_2/timeline") {
        return {
          session: {
            id: "ses_2",
            title: "Proof task",
            state: "verifying",
            currentSummary: "Verifier running",
            lastError: undefined
          },
          task: {
            id: "HTG-0002",
            phase: "verify",
            verificationState: "running"
          },
          approval: {
            id: "apr_2",
            state: "approved",
            reason: "workspace write"
          },
          events: [
            {
              sequence: 1,
              occurredAt: "2026-04-07T10:00:00.000Z",
              type: "session.created",
              payload: { mode: "proof" }
            }
          ]
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mini App server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/session/ses_2`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Session ses_2/);
    assert.match(html, /Verifier running/);
    assert.match(html, /Proof Progress/);
    assert.match(html, /href="\/task\/HTG-0002"/);
    assert.match(html, /1\. 2026-04-07T10:00:00.000Z session\.created/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("startMiniAppServer returns an actionable message when the port is already in use", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied server did not bind to a TCP port");
  }

  const server = createMiniAppServer({
    async fetchJson() {
      return { ok: true } as never;
    }
  });

  try {
    assert.match(formatMiniAppPortConflictMessage(address.port), /another process/);
    await assert.rejects(
      () => startMiniAppServer(server, { port: address.port, logger: { info() {} } }),
      new RegExp(formatMiniAppPortConflictMessage(address.port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    await closeServer(occupied);
    if (server.listening) {
      await closeServer(server);
    }
  }
});

test("startMiniAppServer reuses an already-running HappyTG mini app on the same port", async () => {
  const occupied = createHttpServer((req, res) => {
    if (req.url === "/ready") {
      res.writeHead(503, {
        "content-type": "application/json"
      });
      res.end(JSON.stringify({ ok: false, service: "miniapp", detail: "api unavailable" }));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/plain"
    });
    res.end("ok");
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied Mini App test server did not bind to a TCP port");
  }

  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const server = createMiniAppServer({
    async fetchJson() {
      return { ok: true } as never;
    }
  });

  try {
    const result = await startMiniAppServer(server, {
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
    assert.equal(infoLogs[0]?.message, formatMiniAppPortReuseMessage(address.port));
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startMiniAppServer rejects when a different HappyTG service occupies the mini app port", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: true, service: "api" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("HappyTG service test server did not bind to a TCP port");
  }

  const server = createMiniAppServer({
    async fetchJson() {
      return { ok: true } as never;
    }
  });

  try {
    await assert.rejects(
      () => startMiniAppServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatMiniAppPortConflictMessageDetailed(address.port, { service: "api" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startMiniAppServer names a foreign HTTP listener when the port is occupied", async () => {
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

  const server = createMiniAppServer({
    async fetchJson() {
      return { ok: true } as never;
    }
  });

  try {
    await assert.rejects(
      () => startMiniAppServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatMiniAppPortConflictMessageDetailed(address.port, { description: "HTTP listener (Contacts)" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});
