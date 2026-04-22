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
      if (pathname === "/api/v1/miniapp/dashboard?userId=usr_1") {
        return {
          stats: {
            activeSessions: 1,
            pendingApprovals: 1,
            blockedSessions: 0,
            verifyProblems: 0
          },
          attention: [
            {
              id: "apr_1",
              kind: "approval",
              title: "Нужно подтверждение",
              detail: "workspace write",
              severity: "warn",
              href: "/approval/apr_1",
              nextAction: "Открыть approval"
            }
          ],
          recentSessions: [
            {
              id: "ses_1",
              title: "Quick fix",
              state: "completed",
              runtime: "codex-cli",
              phase: "complete",
              verificationState: "passed",
              hostLabel: "devbox",
              repoName: "projection-repo",
              lastUpdatedAt: "2026-04-21T04:00:00.000Z",
              href: "/session/ses_1",
              nextAction: "open"
            }
          ],
          recentReports: [
            {
              id: "HTG-0001",
              title: "Quick fix",
              status: "passed",
              generatedAt: "2026-04-21T04:00:00.000Z",
              href: "/task/HTG-0001"
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
    const response = await fetch(`http://127.0.0.1:${address.port}/?userId=usr_1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /Панель управления HappyTG/);
    assert.match(html, /Codex CLI/);
    assert.match(html, /devbox/);
    assert.match(html, /Нужно подтверждение/);
    assert.match(html, /href="\/session\/ses_1"/);
    assert.match(html, /href="\/task\/HTG-0001"/);
    assert.match(html, /happytg:miniapp:draft:v1/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("mini app links honor the /miniapp reverse-proxy base path", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/dashboard?userId=usr_1") {
        return {
          stats: {
            activeSessions: 1,
            pendingApprovals: 0,
            blockedSessions: 0,
            verifyProblems: 0
          },
          attention: [],
          recentSessions: [
            {
              id: "ses_1",
              title: "Quick fix",
              state: "running",
              hostLabel: "devbox",
              repoName: "repo",
              lastUpdatedAt: "2026-04-21T04:00:00.000Z",
              href: "/session/ses_1",
              nextAction: "open"
            }
          ],
          recentReports: [
            {
              id: "HTG-0001",
              title: "Quick fix",
              status: "passed",
              generatedAt: "2026-04-21T04:00:00.000Z",
              href: "/task/HTG-0001"
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
    const response = await fetch(`http://127.0.0.1:${address.port}/?userId=usr_1`, {
      headers: {
        "x-forwarded-prefix": "/miniapp"
      }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /href="\/miniapp\/sessions"/);
    assert.match(html, /href="\/miniapp\/session\/ses_1"/);
    assert.match(html, /href="\/miniapp\/task\/HTG-0001"/);
    assert.doesNotMatch(html, /href="\/sessions"/);
  } finally {
    await closeServer(server);
  }
});

test("mini app forwards browser session cookie as bearer auth", async () => {
  const calls: Array<{ pathname: string; authorization?: string }> = [];
  const server = createMiniAppServer({
    async fetchJson(pathname, init) {
      calls.push({
        pathname,
        authorization: init?.headers instanceof Headers
          ? init.headers.get("authorization") ?? undefined
          : (init?.headers as Record<string, string> | undefined)?.authorization
      });
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/sessions") {
        return { sessions: [] } as never;
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
    const response = await fetch(`http://127.0.0.1:${address.port}/sessions`, {
      headers: {
        cookie: "happytg_miniapp_session=mas_token"
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      {
        pathname: "/api/v1/miniapp/sessions",
        authorization: "Bearer mas_token"
      }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("task page renders scoped canonical artifacts", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/tasks/HTG-0001/bundle?userId=usr_1") {
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
          },
          sections: [
            {
              id: "spec",
              label: "Spec",
              files: ["spec.md"]
            },
            {
              id: "verify",
              label: "Verify",
              files: ["verdict.json", "problems.md"]
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
    const response = await fetch(`http://127.0.0.1:${address.port}/task/HTG-0001?userId=usr_1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Task HTG-0001/);
    assert.match(html, /Proof Progress/);
    assert.match(html, /Fresh Verify/);
    assert.match(html, /missing raw\/test-unit.txt/);
    assert.match(html, /Spec: spec\.md/);
    assert.match(html, /Verify: verdict\.json/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("projects page renders workspaces and new task creates a Codex session", async () => {
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const server = createMiniAppServer({
    async fetchJson(pathname, init) {
      calls.push({ pathname, init });
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/projects?userId=usr_1") {
        return {
          projects: [
            {
              id: "ws_1",
              hostId: "host_1",
              hostLabel: "devbox",
              hostStatus: "active",
              repoName: "HappyTG",
              path: "C:/Develop/Projects/HappyTG",
              defaultBranch: "main",
              activeSessions: 2,
              href: "/project/ws_1",
              newSessionHref: "/new-task?hostId=host_1&workspaceId=ws_1"
            }
          ]
        } as never;
      }
      if (pathname === "/api/v1/miniapp/sessions?userId=usr_1") {
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          hostId: "host_1",
          workspaceId: "ws_1",
          mode: "proof",
          title: "Release check",
          prompt: "Check project management",
          acceptanceCriteria: ["Codex session visible"],
          runtime: "codex-cli"
        });
        return {
          session: {
            id: "ses_42",
            title: "Release check",
            state: "created",
            runtime: "codex-cli",
            hostLabel: "devbox",
            repoName: "HappyTG",
            lastUpdatedAt: "2026-04-22T04:00:00.000Z",
            href: "/session/ses_42",
            nextAction: "open"
          }
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
    const projectsResponse = await fetch(`http://127.0.0.1:${address.port}/projects?userId=usr_1`);
    const projectsHtml = await projectsResponse.text();

    assert.equal(projectsResponse.status, 200);
    assert.match(projectsHtml, /HappyTG/);
    assert.match(projectsHtml, /C:\/Develop\/Projects\/HappyTG/);
    assert.match(projectsHtml, /href="\/new-task\?hostId=host_1&amp;workspaceId=ws_1"/);

    const taskResponse = await fetch(`http://127.0.0.1:${address.port}/new-task?userId=usr_1`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        hostId: "host_1",
        workspaceId: "ws_1",
        mode: "proof",
        title: "Release check",
        prompt: "Check project management",
        acceptanceCriteria: ["Codex session visible"]
      })
    });
    const payload = await taskResponse.json() as { sessionHref: string; session: { runtime: string } };

    assert.equal(taskResponse.status, 200);
    assert.equal(payload.sessionHref, "/session/ses_42");
    assert.equal(payload.session.runtime, "codex-cli");
  } finally {
    await closeServer(server);
  }
});

test("session page renders timeline, summary, and task link", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/sessions/ses_2?userId=usr_1") {
        return {
          session: {
            id: "ses_2",
            title: "Proof task",
            state: "verifying",
            runtime: "codex-cli",
            phase: "verify",
            verificationState: "running",
            hostLabel: "devbox",
            repoName: "projection-repo",
            lastUpdatedAt: "2026-04-07T10:00:00.000Z",
            href: "/session/ses_2",
            nextAction: "open",
            currentSummary: "Verifier running",
            lastError: undefined,
            prompt: "Run proof"
          },
          task: {
            id: "HTG-0002",
            sessionId: "ses_2",
            workspaceId: "ws_1",
            rootPath: "/repo/.agent/tasks/HTG-0002",
            mode: "proof",
            title: "Proof task",
            acceptanceCriteria: ["criterion"],
            phase: "verify",
            verificationState: "running",
            createdAt: "2026-04-07T10:00:00.000Z",
            updatedAt: "2026-04-07T10:00:00.000Z"
          },
          approval: {
            id: "apr_2",
            sessionId: "ses_2",
            title: "Proof task",
            state: "approved_once",
            reason: "workspace write",
            risk: "medium",
            expiresAt: "2026-04-07T10:10:00.000Z",
            href: "/approval/apr_2"
          },
          events: [
            {
              sequence: 1,
              occurredAt: "2026-04-07T10:00:00.000Z",
              type: "SessionCreated",
              payload: { mode: "proof" }
            }
          ],
          actions: ["diff", "summary"]
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
    const response = await fetch(`http://127.0.0.1:${address.port}/session/ses_2?userId=usr_1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Proof task/);
    assert.match(html, /Codex CLI/);
    assert.match(html, /Verifier running/);
    assert.match(html, /Proof Progress/);
    assert.match(html, /href="\/task\/HTG-0002"/);
    assert.match(html, /SessionCreated/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("approval page renders real authenticated action buttons", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/approvals/apr_1?userId=usr_1") {
        return {
          approval: {
            id: "apr_1",
            sessionId: "ses_1",
            title: "Approval task",
            state: "waiting_human",
            reason: "workspace write",
            risk: "high",
            scope: "once",
            nonce: "apn_1",
            expiresAt: "2026-04-21T04:10:00.000Z",
            href: "/approval/apr_1"
          },
          session: {
            id: "ses_1",
            title: "Approval task",
            state: "needs_approval",
            lastUpdatedAt: "2026-04-21T04:00:00.000Z",
            href: "/session/ses_1",
            nextAction: "open"
          }
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
    const response = await fetch(`http://127.0.0.1:${address.port}/approval/apr_1?userId=usr_1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /data-approval-action/);
    assert.match(html, /data-approval-id="apr_1"/);
    assert.match(html, /"authorization": "Bearer " \+ sessionToken/);
    assert.match(html, /\/api\/v1\/miniapp\/approvals\//);
    assert.doesNotMatch(html, /href="#"/);
  } finally {
    await closeServer(server);
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
