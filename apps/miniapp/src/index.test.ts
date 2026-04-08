import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createMiniAppServer, formatMiniAppPortConflictMessage, startMiniAppServer } from "./index.js";

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
    await assert.rejects(
      () => startMiniAppServer(server, { port: address.port, logger: { info() {} } }),
      new RegExp(formatMiniAppPortConflictMessage(address.port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
