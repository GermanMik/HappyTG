import assert from "node:assert/strict";
import { createServer, createServer as createHttpServer } from "node:http";
import test from "node:test";

import {
  createMiniAppServer,
  formatMiniAppPortConflictMessage,
  formatMiniAppPortConflictMessageDetailed,
  formatMiniAppPortReuseMessage,
  resolveBrowserApiBaseUrlForRequest,
  startMiniAppServer
} from "./index.js";

async function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

test("public reverse-proxied mini app uses same-origin browser API when local env points at localhost", async () => {
  await withEnv({
    HAPPYTG_BROWSER_API_URL: "",
    HAPPYTG_PUBLIC_URL: "http://localhost:4000",
    HAPPYTG_API_URL: "http://localhost:4000"
  }, async () => {
    const server = createMiniAppServer({
      async fetchJson(pathname) {
        if (pathname === "/health") {
          return { ok: true } as never;
        }
        if (pathname === "/api/v1/miniapp/dashboard?userId=usr_1") {
          return {
            stats: {
              activeSessions: 0,
              pendingApprovals: 0,
              blockedSessions: 0,
              verifyProblems: 0
            },
            attention: [],
            recentSessions: [],
            recentReports: []
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
          "x-forwarded-prefix": "/miniapp",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "happytg.gerta.crazedns.ru"
        }
      });
      const html = await response.text();

      assert.equal(response.status, 200);
      assert.match(html, /window\.HAPPYTgApiBase = "";/);
      assert.match(html, /aria-current="page">Главная/);
    } finally {
      await closeServer(server);
    }
  });
});

test("local direct mini app keeps the explicit local API origin without reverse-proxy headers", async () => {
  assert.equal(resolveBrowserApiBaseUrlForRequest({}, {
    HAPPYTG_BROWSER_API_URL: "",
    HAPPYTG_PUBLIC_URL: "http://localhost:4000",
    HAPPYTG_API_URL: "http://localhost:4000"
  }), "http://localhost:4000");
});

test("auth-pending shell exposes retry-safe auth feedback controls", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
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
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: {
        "x-forwarded-prefix": "/miniapp",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "happytg.gerta.crazedns.ru"
      }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /data-auth-status/);
    assert.match(html, /Повторить подключение/);
    assert.match(html, /data-auth-step="telegram"/);
    assert.match(html, /window\.HAPPYTgNeedsAuth = true/);
    assert.match(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
    assert.match(html, /var initDataWaitTimer = 0/);
    assert.match(html, /if \(!initDataWaitTimer\) \{\s+initDataWaitTimer = window\.setTimeout\(waitForTelegramInitData, initDataPollMs\);/);
    assert.match(html, /initDataWaitTimeoutMs = 5000/);
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
      if (pathname === "/api/v1/codex-desktop/projects") {
        return { projects: [] } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions") {
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
      },
      {
        pathname: "/api/v1/codex-desktop/projects",
        authorization: "Bearer mas_token"
      },
      {
        pathname: "/api/v1/codex-desktop/sessions",
        authorization: "Bearer mas_token"
      }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("codex panel renders source-aware Desktop and CLI sessions with disabled unsupported actions", async () => {
  const server = createMiniAppServer({
    async fetchJson(pathname) {
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/sessions?userId=usr_1") {
        return {
          sessions: [
            {
              id: "ses_cli",
              title: "CLI fixture",
              state: "ready",
              runtime: "codex-cli",
              repoName: "HappyTG",
              hostLabel: "devbox",
              lastUpdatedAt: "2026-04-28T08:00:00.000Z",
              href: "/session/ses_cli",
              nextAction: "open"
            }
          ]
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/projects?userId=usr_1") {
        return {
          projects: [
            {
              id: "cdp_1",
              label: "HappyTG",
              path: "C:/Develop/Projects/HappyTG",
              source: "codex-desktop",
              active: true
            }
          ]
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions?userId=usr_1") {
        return {
          sessions: [
            {
              id: "desktop-session-1",
              title: "Desktop fixture",
              projectPath: "C:/Develop/Projects/HappyTG",
              projectId: "cdp_1",
              updatedAt: "2026-04-28T09:00:00.000Z",
              status: "recent",
              source: "codex-desktop",
              canResume: false,
              canStop: false,
              canCreateTask: false,
              unsupportedReason: "contract missing",
              unsupportedReasonCode: "CODEX_DESKTOP_CONTROL_UNSUPPORTED",
              rawPayload: "RAW_PROMPT_SECRET"
            }
          ]
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions/desktop-session-1?userId=usr_1") {
        return {
          session: {
            id: "desktop-session-1",
            title: "Desktop fixture",
            projectPath: "C:/Develop/Projects/HappyTG",
            projectId: "cdp_1",
            updatedAt: "2026-04-28T09:00:00.000Z",
            status: "recent",
            source: "codex-desktop",
            canResume: false,
            canStop: false,
            canCreateTask: false,
            unsupportedReason: "contract missing",
            unsupportedReasonCode: "CODEX_DESKTOP_CONTROL_UNSUPPORTED"
          },
          history: [
            {
              id: "cdh_1",
              sequence: 1,
              occurredAt: "2026-04-28T09:01:00.000Z",
              kind: "message",
              role: "assistant",
              title: "assistant message",
              summary: "Safe desktop answer",
              source: "codex-desktop"
            }
          ],
          historyTruncated: false
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
    const response = await fetch(`http://127.0.0.1:${address.port}/codex?userId=usr_1&source=all&state=recent&q=Desktop`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Codex Desktop \/ CLI/);
    assert.match(html, /Codex Desktop/);
    assert.match(html, /Codex CLI/);
    assert.match(html, /Desktop fixture/);
    assert.match(html, /recent/);
    assert.match(html, /contract missing/);
    assert.match(html, /CODEX_DESKTOP_CONTROL_UNSUPPORTED/);
    assert.doesNotMatch(html, /CLI fixture/);
    assert.doesNotMatch(html, /RAW_PROMPT_SECRET/);

    const detailResponse = await fetch(`http://127.0.0.1:${address.port}/codex/desktop-session?id=desktop-session-1&userId=usr_1`);
    const detailHtml = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.match(detailHtml, /Resume/);
    assert.match(detailHtml, /Stop/);
    assert.match(detailHtml, /New Desktop Task/);
    assert.match(detailHtml, /disabled/);
    assert.match(detailHtml, /CODEX_DESKTOP_CONTROL_UNSUPPORTED/);
    assert.match(detailHtml, /History/);
    assert.match(detailHtml, /Safe desktop answer/);
    assert.doesNotMatch(detailHtml, /data-desktop-action="resume"/);
    assert.doesNotMatch(detailHtml, /RAW_PROMPT_SECRET/);
  } finally {
    await closeServer(server);
  }
});

test("mini app renders supported Desktop actions and forwards new Desktop task to API", async () => {
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const desktopSession = {
    id: "desktop-supported",
    title: "Desktop supported",
    projectPath: "C:/Develop/Projects/HappyTG",
    projectId: "cdp_1",
    updatedAt: "2026-04-28T09:00:00.000Z",
    status: "active",
    source: "codex-desktop",
    canResume: true,
    canStop: true,
    canCreateTask: true
  };
  const server = createMiniAppServer({
    async fetchJson(pathname, init) {
      calls.push({ pathname, init });
      if (pathname === "/health") {
        return { ok: true } as never;
      }
      if (pathname === "/api/v1/miniapp/sessions?userId=usr_1") {
        return { sessions: [] } as never;
      }
      if (pathname === "/api/v1/codex-desktop/projects?userId=usr_1") {
        return {
          projects: [
            {
              id: "cdp_1",
              label: "HappyTG",
              path: "C:/Develop/Projects/HappyTG",
              source: "codex-desktop"
            }
          ]
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions?userId=usr_1") {
        return { sessions: [desktopSession] } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions/desktop-supported?userId=usr_1") {
        return {
          session: desktopSession,
          history: [],
          historyTruncated: false,
          historyUnsupportedReason: "No Codex Desktop JSONL history file was found for this session.",
          historyUnsupportedReasonCode: "CODEX_DESKTOP_HISTORY_UNAVAILABLE"
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/tasks?userId=usr_1") {
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          runtime: "codex-desktop",
          projectPath: "C:/Develop/Projects/HappyTG",
          prompt: "Run Desktop task"
        });
        return {
          task: {
            id: "cdt_1",
            title: "Desktop task",
            status: "created"
          }
        } as never;
      }
      if (pathname === "/api/v1/codex-desktop/sessions/desktop-supported/resume?userId=usr_1") {
        assert.equal(init?.method, "POST");
        return {
          ok: true,
          action: "resume",
          source: "codex-desktop",
          session: desktopSession
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
    const detailResponse = await fetch(`http://127.0.0.1:${address.port}/codex/desktop-session?id=desktop-supported&userId=usr_1`);
    const detailHtml = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.match(detailHtml, /data-desktop-action="resume"/);
    assert.match(detailHtml, /data-desktop-action="stop"/);
    assert.match(detailHtml, /New Desktop Task/);

    const action = await fetch(`http://127.0.0.1:${address.port}/codex/desktop-action?userId=usr_1`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "desktop-supported",
        action: "resume"
      })
    });
    const actionPayload = await action.json() as { action: string };
    assert.equal(action.status, 200);
    assert.equal(actionPayload.action, "resume");

    const created = await fetch(`http://127.0.0.1:${address.port}/new-task?userId=usr_1`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        runtime: "codex-desktop",
        projectPath: "C:/Develop/Projects/HappyTG",
        prompt: "Run Desktop task"
      })
    });
    const payload = await created.json() as { task: { id: string }; sessionHref: string };

    assert.equal(created.status, 200);
    assert.equal(payload.task.id, "cdt_1");
    assert.equal(payload.sessionHref, "/codex?source=codex-desktop");
    assert.equal(calls.some((call) => call.pathname === "/api/v1/codex-desktop/tasks?userId=usr_1"), true);
    assert.equal(calls.some((call) => call.pathname === "/api/v1/codex-desktop/sessions/desktop-supported/resume?userId=usr_1"), true);
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
    assert.match(html, /Задача HTG-0001/);
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
    assert.match(projectsHtml, /Создать Codex-сессию/);
    assert.match(projectsHtml, /data-task-feedback/);

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
    assert.match(html, /data-action-feedback/);
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
