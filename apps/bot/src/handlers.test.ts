import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovalRequest, CodexDesktopProject, CodexDesktopSession, Host, Session, TaskBundle, Workspace } from "../../../packages/protocol/src/index.js";

import type { BotDependencies } from "./handlers.js";
import { createBotHandlers, inspectTelegramMiniAppLaunch, resolveMiniAppBaseUrl } from "./handlers.js";

interface CapturedMessage {
  chatId: number;
  text: string;
  replyMarkup?: Record<string, unknown>;
}

const now = "2026-04-21T00:00:00.000Z";

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "host_1",
    label: "devbox",
    fingerprint: "fp",
    status: "active",
    capabilities: ["codex-cli"],
    lastSeenAt: now,
    pairedUserId: "usr_42",
    runtimePreference: "codex-cli",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws_1",
    hostId: "host_1",
    path: "C:/repo",
    repoName: "repo",
    defaultBranch: "main",
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    userId: "usr_42",
    hostId: "host_1",
    workspaceId: "ws_1",
    mode: "quick",
    runtime: "codex-cli",
    state: "ready",
    title: "Quick task: inspect status",
    prompt: "inspect status",
    currentSummary: "Waiting for host reconnect",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "apr_1",
    sessionId: "ses_1",
    actionKind: "workspace_write",
    state: "waiting_human",
    scope: "once",
    nonce: "apn_1",
    risk: "high",
    reason: "Policy requires approval",
    expiresAt: "2026-04-21T00:10:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function task(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    id: "HTG-0001",
    sessionId: "ses_1",
    workspaceId: "ws_1",
    rootPath: "C:/repo/.agent/tasks/HTG-0001",
    phase: "freeze",
    mode: "proof",
    title: "Proof task",
    acceptanceCriteria: ["criterion"],
    verificationState: "not_started",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function desktopProject(overrides: Partial<CodexDesktopProject> = {}): CodexDesktopProject {
  return {
    id: "cdp_1",
    label: "HappyTG",
    path: "C:/Develop/Projects/HappyTG",
    source: "codex-desktop",
    active: true,
    ...overrides
  };
}

function desktopSession(overrides: Partial<CodexDesktopSession> = {}): CodexDesktopSession {
  return {
    id: "desktop-session-1",
    title: "Desktop fixture",
    projectPath: "C:/Develop/Projects/HappyTG",
    projectId: "cdp_1",
    updatedAt: now,
    status: "recent",
    source: "codex-desktop",
    canResume: false,
    canStop: false,
    canCreateTask: false,
    unsupportedReason: "contract missing",
    unsupportedReasonCode: "CODEX_DESKTOP_CONTROL_UNSUPPORTED",
    ...overrides
  };
}

function collectWebAppUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectWebAppUrls(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const webApp = record.web_app;
  const current = webApp && typeof webApp === "object" && typeof (webApp as { url?: unknown }).url === "string"
    ? [(webApp as { url: string }).url]
    : [];
  return [
    ...current,
    ...Object.values(record).flatMap((item) => collectWebAppUrls(item))
  ];
}

test("menu command renders a concise action-first main menu", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [session()],
        approvals: [approval()],
        tasks: [task()]
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    miniAppBaseUrl: "https://happy.example/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/menu",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.deepEqual(calls.map((call) => call.pathname), [
    "/api/v1/users/by-telegram/42",
    "/api/v1/miniapp/bootstrap?userId=usr_42"
  ]);
  assert.match(messages[0]?.text ?? "", /Активные сессии: 1/);
  assert.match(messages[0]?.text ?? "", /Ждут подтверждения: 1/);
  assert.deepEqual((messages[0]?.replyMarkup as { inline_keyboard: unknown[] })?.inline_keyboard.length, 4);
  assert.deepEqual(collectWebAppUrls(messages[0]?.replyMarkup), ["https://happy.example/miniapp?screen=home"]);
});

test("menu command omits Telegram web_app buttons when Mini App URL is local HTTP", async () => {
  const messages: CapturedMessage[] = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [session()],
        approvals: [],
        tasks: []
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    miniAppBaseUrl: "http://localhost:4000/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/menu",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.deepEqual(collectWebAppUrls(messages[0]?.replyMarkup), []);
  assert.match(JSON.stringify(messages[0]?.replyMarkup), /callback_data/);
  assert.match(JSON.stringify(messages[0]?.replyMarkup), /m:r/);
});

test("start command preserves the inline Mini App web_app button for public HTTPS URLs", async () => {
  const messages: CapturedMessage[] = [];
  const handlers = createBotHandlers({
    miniAppBaseUrl: "https://happy.example/miniapp",
    async apiFetch(pathname) {
      if (pathname === "/api/v1/users/by-telegram/42") {
        throw new Error("not paired");
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/start",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.match(messages[0]?.text ?? "", /Сначала подключите host/);
  assert.deepEqual(collectWebAppUrls(messages[0]?.replyMarkup), ["https://happy.example/miniapp?screen=home"]);
});

test("mini app url resolver derives public https URL before legacy dev app URL", () => {
  const resolved = resolveMiniAppBaseUrl({
    NODE_ENV: "development",
    HAPPYTG_APP_URL: "http://localhost:3001",
    HAPPYTG_PUBLIC_URL: "https://happy.example.com"
  });

  assert.equal(resolved.status, "ready");
  assert.equal(resolved.url, "https://happy.example.com/miniapp");
  assert.equal(resolved.source, "HAPPYTG_PUBLIC_URL");
});

test("mini app launch diagnostics prefer the local Mini App port over the local API URL", () => {
  const env = {
    NODE_ENV: "development",
    HAPPYTG_MINIAPP_PORT: "3007",
    HAPPYTG_APP_URL: "http://localhost:3007",
    HAPPYTG_PUBLIC_URL: "http://localhost:4000"
  };
  const resolved = resolveMiniAppBaseUrl(env);
  const launch = inspectTelegramMiniAppLaunch(env);

  assert.equal(resolved.status, "degraded");
  assert.equal(resolved.source, "HAPPYTG_APP_URL");
  assert.equal(launch.status, "disabled");
  assert.equal(launch.url, "http://localhost:3007/");
  assert.match(launch.detail, /Local polling can still handle Telegram bot commands/i);
  assert.match(launch.detail, /public HTTPS \/miniapp URL/i);
});

test("mini app url resolver degrades invalid production URL", () => {
  const resolved = resolveMiniAppBaseUrl({
    NODE_ENV: "production",
    HAPPYTG_MINIAPP_URL: "http://localhost:3001"
  });

  assert.equal(resolved.status, "degraded");
  assert.equal(resolved.url, undefined);
  assert.match(resolved.detail, /HTTPS|localhost/i);
});

test("inline web_app buttons use the production mini app URL", async () => {
  const messages: CapturedMessage[] = [];
  const handlers = createBotHandlers({
    async apiFetch(pathname) {
      if (pathname === "/api/v1/users/by-telegram/42") {
        return { id: "usr_42" } as never;
      }
      if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
        return {
          hosts: [host()],
          workspaces: [workspace()],
          sessions: [session()],
          approvals: [],
          tasks: []
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    miniAppBaseUrl: "https://happy.example.com/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/menu",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /https:\/\/happy\.example\.com\/miniapp\?screen=home/);
  assert.doesNotMatch(JSON.stringify(messages[0]?.replyMarkup ?? {}), /localhost:3001/);
});

test("task wizard uses smart defaults and creates a proof session from callback flow", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/hosts?userId=usr_42") {
      return { hosts: [host()] } as never;
    }
    if (pathname === "/api/v1/hosts/host_1/workspaces?userId=usr_42") {
      return { workspaces: [workspace()] } as never;
    }
    if (pathname === "/api/v1/sessions") {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { mode: string; prompt: string };
      assert.equal(payload.mode, "proof");
      assert.equal(payload.prompt, "Build the dashboard");
      return {
        session: session({
          id: "ses_proof",
          mode: "proof",
          state: "needs_approval",
          title: "Proof task: Build the dashboard",
          taskId: "HTG-0001",
          approvalId: "apr_1"
        }),
        task: task({ id: "HTG-0001", sessionId: "ses_proof" }),
        approval: approval({ id: "apr_1", sessionId: "ses_proof" })
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    miniAppBaseUrl: "https://happy.example/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/task",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_runtime",
    data: "cx:ns:c",
    from: { id: 42, username: "dev" },
    message: { message_id: 2, chat: { id: 100 }, text: "runtime" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_mode",
    data: "w:m:p",
    from: { id: 42, username: "dev" },
    message: { message_id: 3, chat: { id: 100 }, text: "mode" }
  });
  await handlers.handleMessage({
    message_id: 4,
    text: "Build the dashboard",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_confirm",
    data: "w:c",
    from: { id: 42, username: "dev" },
    message: { message_id: 5, chat: { id: 100 }, text: "confirm" }
  });

  assert.match(messages[0]?.text ?? "", /runtime\/source/);
  assert.match(messages[1]?.text ?? "", /Repo: repo/);
  assert.match(messages[2]?.text ?? "", /proof-loop/);
  assert.match(messages[3]?.text ?? "", /Проверим перед запуском/);
  assert.match(messages.at(-1)?.text ?? "", /Подтверждение apr_1/);
  assert.equal(calls.some((call) => call.pathname === "/api/v1/sessions" && call.init?.method === "POST"), true);
});

test("codex menu separates Desktop and CLI sessions and hides unsupported Desktop actions", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [session({ id: "ses_cli", title: "CLI fixture" })],
        approvals: [],
        tasks: []
      } as never;
    }
    if (pathname === "/api/v1/codex-desktop/projects?userId=usr_42") {
      return { projects: [desktopProject()] } as never;
    }
    if (pathname === "/api/v1/codex-desktop/sessions?userId=usr_42") {
      return { sessions: [desktopSession()] } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    miniAppBaseUrl: "https://happy.example/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/codex",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_desktop",
    data: "cx:d",
    from: { id: 42, username: "dev" },
    message: { message_id: 2, chat: { id: 100 }, text: "codex" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_projects",
    data: "cd:p",
    from: { id: 42, username: "dev" },
    message: { message_id: 3, chat: { id: 100 }, text: "desktop" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_card",
    data: "cd:u:desktop-session-1",
    from: { id: 42, username: "dev" },
    message: { message_id: 4, chat: { id: 100 }, text: "desktop" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_cli",
    data: "cc:s",
    from: { id: 42, username: "dev" },
    message: { message_id: 5, chat: { id: 100 }, text: "codex" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_desktop_new",
    data: "cx:ns:d",
    from: { id: 42, username: "dev" },
    message: { message_id: 6, chat: { id: 100 }, text: "codex" }
  });

  assert.match(messages[0]?.text ?? "", /Codex Desktop/);
  assert.match(messages[0]?.text ?? "", /Codex CLI/);
  assert.match(messages[1]?.text ?? "", /Codex Desktop sessions/);
  assert.match(messages[2]?.text ?? "", /Codex Desktop projects/);
  assert.match(messages[2]?.text ?? "", /HappyTG/);
  assert.match(messages[3]?.text ?? "", /Источник: Codex Desktop/);
  assert.match(messages[3]?.text ?? "", /Resume: unsupported/);
  assert.match(messages[3]?.text ?? "", /CODEX_DESKTOP_CONTROL_UNSUPPORTED/);
  assert.match(messages[4]?.text ?? "", /Активные сессии/);
  assert.match(messages[4]?.text ?? "", /CLI fixture/);
  assert.match(messages[5]?.text ?? "", /New Desktop Task сейчас недоступен/);
  assert.match(messages[5]?.text ?? "", /CODEX_DESKTOP_CONTROL_UNSUPPORTED/);
  assert.doesNotMatch(JSON.stringify(messages[3]?.replyMarkup ?? {}), /cd:[rx]:desktop-session-1/);
  assert.equal(calls.some((call) => call.pathname === "/api/v1/sessions" && call.init?.method === "POST"), false);
});

test("desktop session callbacks use short stable refs for long Desktop ids", async () => {
  const messages: CapturedMessage[] = [];
  const longSessionId = `desktop-session-${"x".repeat(80)}`;
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/codex-desktop/sessions?userId=usr_42") {
      return { sessions: [desktopSession({ id: longSessionId })] } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleCallbackQuery({
    id: "cb_desktop_sessions",
    data: "cd:s",
    from: { id: 42, username: "dev" },
    message: { message_id: 1, chat: { id: 100 }, text: "desktop" }
  });

  const markup = JSON.stringify(messages[0]?.replyMarkup ?? {});
  assert.doesNotMatch(markup, new RegExp(longSessionId));
  const callbackRef = markup.match(/cd:u:([^"}]+)/)?.[1];
  assert.match(callbackRef ?? "", /^cds_[0-9a-f]{24}$/);

  await handlers.handleCallbackQuery({
    id: "cb_desktop_card",
    data: `cd:u:${callbackRef}`,
    from: { id: 42, username: "dev" },
    message: { message_id: 2, chat: { id: 100 }, text: "desktop" }
  });

  assert.match(messages[1]?.text ?? "", /Источник: Codex Desktop/);
});

test("task wizard opportunistically sweeps expired drafts on unrelated updates", async () => {
  let currentTime = 0;
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/users/by-telegram/43") {
      return { id: "usr_43" } as never;
    }
    if (pathname === "/api/v1/hosts?userId=usr_42") {
      return { hosts: [host()] } as never;
    }
    if (pathname === "/api/v1/hosts/host_1/workspaces?userId=usr_42") {
      return { workspaces: [workspace()] } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_43") {
      return {
        hosts: [],
        workspaces: [],
        sessions: [],
        approvals: [],
        tasks: []
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    now: () => currentTime,
    async sendTelegramMessage() {}
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/task",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  assert.equal(handlers.wizardDraftCount(), 1);

  currentTime = 31 * 60 * 1000;
  await handlers.handleMessage({
    message_id: 2,
    text: "/menu",
    chat: { id: 101 },
    from: { id: 43, username: "other" }
  });

  assert.equal(handlers.wizardDraftCount(), 0);
});

test("verify command surfaces scoped approval keyboard with nonce", async () => {
  const messages: CapturedMessage[] = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/77") {
      return { id: "usr_77" } as never;
    }
    if (pathname === "/api/v1/hosts/host_2/bootstrap/verify") {
      return {
        session: session({
          id: "ses_verify",
          userId: "usr_77",
          hostId: "host_2",
          title: "Bootstrap verify: buildbox",
          state: "needs_approval"
        }),
        approval: approval({ id: "apr_1", sessionId: "ses_verify", nonce: "apn_1" })
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 3,
    text: "/verify host_2",
    chat: { id: 102 },
    from: { id: 77, username: "ops" }
  });

  assert.match(messages[0]?.text ?? "", /Подтверждение/);
  assert.deepEqual(messages[0]?.replyMarkup, {
    inline_keyboard: [
      [
        { text: "Разрешить один раз", callback_data: "a:o:apr_1:apn_1" }
      ],
      [
        { text: "Разрешить на фазу", callback_data: "a:p:apr_1:apn_1" },
        { text: "Разрешить на сессию", callback_data: "a:s:apr_1:apn_1" }
      ],
      [
        { text: "Отклонить", callback_data: "a:d:apr_1:apn_1" },
        { text: "Подробнее", callback_data: "a:x:apr_1" }
      ]
    ]
  });
});

test("approval callback resolves with scope and nonce for the linked HappyTG user", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/88") {
      return { id: "usr_88" } as never;
    }
    if (pathname === "/api/v1/approvals/apr_9/resolve") {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { scope?: string; nonce?: string };
      assert.equal(payload.scope, "session");
      assert.equal(payload.nonce, "apn_9");
      return {
        approval: approval({ id: "apr_9", state: "approved_session" }),
        session: session({ id: "ses_9", state: "ready" })
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleCallbackQuery({
    id: "cb_1",
    data: "a:s:apr_9:apn_9",
    from: { id: 88, username: "lead" },
    message: {
      message_id: 4,
      chat: { id: 103 },
      text: "Approve?"
    }
  });

  assert.deepEqual(
    calls.map((call) => call.pathname),
    ["/api/v1/users/by-telegram/88", "/api/v1/approvals/apr_9/resolve"]
  );
  assert.match(messages[0]?.text ?? "", /approved_session/);
  assert.match(messages[0]?.text ?? "", /Сессия -> ready/);
});

test("resume command posts resume and then renders a session card", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/sessions/ses_1/resume") {
      return session({ id: "ses_1", state: "resuming" }) as never;
    }
    if (pathname === "/api/v1/sessions/ses_1") {
      return session({ id: "ses_1", state: "resuming" }) as never;
    }
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [session({ id: "ses_1", state: "resuming" })],
        approvals: [],
        tasks: []
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/resume ses_1",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.equal(calls[0]?.pathname, "/api/v1/sessions/ses_1/resume");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.match(messages[0]?.text ?? "", /Сессия ses_1/);
  assert.match(messages[0]?.text ?? "", /resuming/);
});

test("session card shows cancel only for active sessions", async () => {
  const messages: CapturedMessage[] = [];
  const handlers = createBotHandlers({
    async apiFetch(pathname) {
      if (pathname === "/api/v1/sessions/ses_active") {
        return session({ id: "ses_active", state: "running" }) as never;
      }
      if (pathname === "/api/v1/sessions/ses_done") {
        return session({ id: "ses_done", state: "completed" }) as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/status ses_active",
    chat: { id: 100 }
  });
  await handlers.handleMessage({
    message_id: 2,
    text: "/status ses_done",
    chat: { id: 100 }
  });

  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /s:c:ses_active/);
  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /Остановить/);
  assert.doesNotMatch(JSON.stringify(messages[1]?.replyMarkup ?? {}), /s:c:ses_done/);
});

test("active sessions list includes a stop button for each active session", async () => {
  const messages: CapturedMessage[] = [];
  const handlers = createBotHandlers({
    async apiFetch(pathname) {
      if (pathname === "/api/v1/users/by-telegram/42") {
        return { id: "usr_42" } as never;
      }
      if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
        return {
          hosts: [host()],
          workspaces: [workspace()],
          sessions: [session({ id: "ses_active", state: "running" })],
          approvals: [],
          tasks: []
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/sessions",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });

  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /s:u:ses_active/);
  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /s:c:ses_active/);
  assert.match(JSON.stringify(messages[0]?.replyMarkup ?? {}), /Остановить/);
});

test("session cancel callback posts cancel and renders updated card", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/sessions/ses_1/cancel") {
      return session({ id: "ses_1", state: "cancelled" }) as never;
    }
    if (pathname === "/api/v1/sessions/ses_1") {
      return session({ id: "ses_1", state: "cancelled" }) as never;
    }
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [session({ id: "ses_1", state: "cancelled" })],
        approvals: [],
        tasks: []
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleCallbackQuery({
    id: "cb_cancel",
    data: "s:c:ses_1",
    from: { id: 42, username: "dev" },
    message: { message_id: 1, chat: { id: 100 }, text: "session" }
  });

  assert.equal(calls[0]?.pathname, "/api/v1/sessions/ses_1/cancel");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.match(messages[0]?.text ?? "", /cancelled/);
  assert.doesNotMatch(JSON.stringify(messages[0]?.replyMarkup ?? {}), /s:c:ses_1/);
});

test("session approval report and callback detail flows never emit local HTTP web_app buttons", async () => {
  const messages: CapturedMessage[] = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/miniapp/bootstrap?userId=usr_42") {
      return {
        hosts: [host()],
        workspaces: [workspace()],
        sessions: [],
        approvals: [],
        tasks: []
      } as never;
    }
    if (pathname === "/api/v1/approvals?userId=usr_42&state=waiting_human,pending") {
      return { approvals: [] } as never;
    }
    if (pathname === "/api/v1/sessions/ses_1") {
      return session({ id: "ses_1" }) as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    miniAppBaseUrl: "http://localhost:4000/miniapp",
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/sessions",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleMessage({
    message_id: 2,
    text: "/approve",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleMessage({
    message_id: 3,
    text: "/status ses_1",
    chat: { id: 100 },
    from: { id: 42, username: "dev" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_diff",
    data: "s:d:ses_1",
    from: { id: 42, username: "dev" },
    message: { message_id: 4, chat: { id: 100 }, text: "session" }
  });
  await handlers.handleCallbackQuery({
    id: "cb_reports",
    data: "m:r",
    from: { id: 42, username: "dev" },
    message: { message_id: 5, chat: { id: 100 }, text: "menu" }
  });

  assert.equal(messages.length, 5);
  assert.deepEqual(messages.flatMap((message) => collectWebAppUrls(message.replyMarkup)), []);
  assert.match(JSON.stringify(messages.map((message) => message.replyMarkup)), /callback_data/);
  assert.match(messages[3]?.text ?? "", /Mini App-кнопка недоступна/);
  assert.match(messages[4]?.text ?? "", /Mini App-кнопка недоступна/);
});
