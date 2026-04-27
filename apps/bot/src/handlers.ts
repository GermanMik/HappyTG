import { createHash } from "node:crypto";

import type {
  ApprovalRequest,
  ApprovalScope,
  CodexDesktopProject,
  CodexDesktopSession,
  CodexRuntimeSource,
  CreateSessionRequest,
  Host,
  ResolveApprovalRequest,
  Session,
  TaskBundle,
  Workspace
} from "../../../packages/protocol/src/index.js";
import {
  resolveMiniAppBaseUrl as resolveSharedMiniAppBaseUrl,
  validatePublicHttpsUrl
} from "../../../packages/shared/src/index.js";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface BotDependencies {
  apiFetch<T>(pathname: string, init?: RequestInit): Promise<T>;
  sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void>;
  editTelegramMessage?(chatId: number, messageId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void>;
  resolveInternalUserId?(user: TelegramUser): Promise<string | undefined>;
  miniAppBaseUrl?: string;
  now?(): number;
}

interface MiniAppOverview {
  hosts: Host[];
  workspaces: Workspace[];
  sessions: Session[];
  approvals: ApprovalRequest[];
  tasks: TaskBundle[];
}

interface SessionDetail extends Session {
  task?: TaskBundle;
  approval?: ApprovalRequest;
}

interface TaskWizardDraft {
  userId: string;
  chatId: number;
  runtime?: CodexRuntimeSource;
  hostId?: string;
  hostLabel?: string;
  workspaceId?: string;
  workspaceLabel?: string;
  mode?: "quick" | "proof";
  prompt?: string;
  updatedAt: number;
}

const DRAFT_TTL_MS = 30 * 60 * 1000;
const TERMINAL_SESSION_STATES = new Set(["completed", "failed", "cancelled"]);
const WAITING_APPROVAL_STATES = new Set(["pending", "waiting_human"]);

type MiniAppUrlSource = "HAPPYTG_MINIAPP_URL" | "HAPPYTG_PUBLIC_URL" | "HAPPYTG_APP_URL";
type InlineKeyboardButton = Record<string, unknown>;

export interface MiniAppUrlResolution {
  status: "ready" | "degraded";
  detail: string;
  url?: string;
  source?: MiniAppUrlSource;
}

export interface TelegramMiniAppLaunchSnapshot {
  status: "ready" | "disabled";
  url?: string;
  detail: string;
}

function userDisplayName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `tg-${user.id}`;
}

function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}...`;
}

function desktopSessionCallbackRef(sessionId: string): string {
  if (sessionId.length <= 48) {
    return sessionId;
  }

  return `cds_${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}

function desktopSessionMatchesRef(session: CodexDesktopSession, ref: string): boolean {
  return session.id === ref || desktopSessionCallbackRef(session.id) === ref;
}

function trimLine(value: string, max = 90): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}...`;
}

function isActiveSession(session: Session): boolean {
  return !TERMINAL_SESSION_STATES.has(session.state);
}

function isWaitingApproval(approval: ApprovalRequest): boolean {
  return WAITING_APPROVAL_STATES.has(approval.state);
}

export function defaultMiniAppBaseUrl(env = process.env): string | undefined {
  return resolveSharedMiniAppBaseUrl(env);
}

function miniAppUrlSource(env: NodeJS.ProcessEnv, resolvedUrl: string | undefined): MiniAppUrlSource | undefined {
  if (!resolvedUrl) {
    return undefined;
  }
  const candidates: Array<[MiniAppUrlSource, string | undefined]> = [
    ["HAPPYTG_MINIAPP_URL", env.HAPPYTG_MINIAPP_URL?.trim() || undefined],
    ["HAPPYTG_APP_URL", env.HAPPYTG_APP_URL?.trim() || undefined],
    ["HAPPYTG_PUBLIC_URL", env.HAPPYTG_PUBLIC_URL?.trim() ? (() => {
      try {
        return new URL("/miniapp", env.HAPPYTG_PUBLIC_URL).toString();
      } catch {
        return env.HAPPYTG_PUBLIC_URL;
      }
    })() : undefined]
  ];
  return candidates.find(([, candidate]) => candidate === resolvedUrl)?.[0];
}

function inspectTelegramWebAppUrl(rawValue: string | undefined): {
  ok: boolean;
  url?: string;
  reason: string;
} {
  const validation = validatePublicHttpsUrl(rawValue, "the resolved Mini App URL");

  return validation.ok && validation.url
    ? {
      ok: true,
      url: validation.url,
      reason: "the resolved Mini App URL is public HTTPS."
    }
    : {
      ok: false,
      ...(validation.url ? { url: validation.url } : {}),
      reason: validation.reason ?? "the resolved Mini App URL is not configured."
    };
}

export function resolveMiniAppBaseUrl(env = process.env): MiniAppUrlResolution {
  const resolvedUrl = defaultMiniAppBaseUrl(env);
  const source = miniAppUrlSource(env, resolvedUrl);
  const inspection = inspectTelegramWebAppUrl(resolvedUrl);
  if (inspection.ok && inspection.url) {
    return {
      status: "ready",
      detail: `${source ?? "Mini App URL"} is a public HTTPS Mini App URL.`,
      url: inspection.url,
      ...(source ? { source } : {})
    };
  }

  return {
    status: "degraded",
    detail: inspection.reason,
    ...(source ? { source } : {})
  };
}

export function inspectTelegramMiniAppLaunch(env = process.env): TelegramMiniAppLaunchSnapshot {
  const inspection = inspectTelegramWebAppUrl(defaultMiniAppBaseUrl(env));
  if (inspection.ok) {
    return {
      status: "ready",
      url: inspection.url,
      detail: "Telegram Mini App launch buttons are enabled with a public HTTPS URL."
    };
  }

  return {
    status: "disabled",
    ...(inspection.url ? { url: inspection.url } : {}),
    detail: `Local polling can still handle Telegram bot commands, but Mini App launch buttons are disabled because ${inspection.reason} Set \`HAPPYTG_MINIAPP_URL\` or \`HAPPYTG_APP_URL\` to a public HTTPS /miniapp URL to enable Telegram WebApp buttons.`
  };
}

function miniAppUrl(baseUrl: string | undefined, screen?: string, params: Record<string, string> = {}): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  try {
    const url = new URL(baseUrl);
    if (screen) {
      url.searchParams.set("screen", screen);
    }
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function telegramWebAppButton(
  text: string,
  miniBaseUrl: string | undefined,
  screen?: string,
  params: Record<string, string> = {}
): InlineKeyboardButton | undefined {
  const url = miniAppUrl(miniBaseUrl, screen, params);
  const inspection = inspectTelegramWebAppUrl(url);
  if (!inspection.ok || !inspection.url) {
    return undefined;
  }

  return { text, web_app: { url: inspection.url } };
}

function inlineKeyboard(rows: InlineKeyboardButton[][]): Record<string, unknown> {
  return {
    inline_keyboard: rows.filter((row) => row.length > 0)
  };
}

function miniAppUnavailableText(): string {
  return "Mini App-кнопка недоступна: задайте публичный HTTPS `HAPPYTG_MINIAPP_URL` или `HAPPYTG_APP_URL`.";
}

function mainMenuKeyboard(miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Открыть Mini App", miniBaseUrl, "home");
  return inlineKeyboard([
      [
        { text: "Codex", callback_data: "cx:m" },
        { text: "Новая задача", callback_data: "m:t" }
      ],
      [
        { text: "Активные сессии", callback_data: "m:s" },
        { text: "Codex CLI", callback_data: "cc:s" }
      ],
      [
        { text: "Подтверждения", callback_data: "m:a" },
        { text: "Хосты", callback_data: "m:h" }
      ],
      [
        { text: "Последние отчеты", callback_data: "m:r" },
        ...(miniAppButton ? [miniAppButton] : [])
      ]
  ]);
}

function approvalCallbackData(code: "o" | "p" | "s" | "d", approvalId: string, nonce?: string): string {
  return nonce ? `a:${code}:${approvalId}:${nonce}` : `a:${code}:${approvalId}`;
}

function codexMenuKeyboard(miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Открыть Mini App", miniBaseUrl, "codex");
  return inlineKeyboard([
    [
      { text: "Codex Desktop", callback_data: "cx:d" },
      { text: "Codex CLI", callback_data: "cx:c" }
    ],
    [
      { text: "Новая CLI задача", callback_data: "cx:ns:c" },
      { text: "Новая Desktop задача", callback_data: "cx:ns:d" }
    ],
    [
      { text: "Desktop projects", callback_data: "cd:p" },
      { text: "Desktop sessions", callback_data: "cd:s" }
    ],
    miniAppButton ? [miniAppButton] : []
  ]);
}

function runtimeSelectionKeyboard(): Record<string, unknown> {
  return inlineKeyboard([
    [
      { text: "Codex Desktop", callback_data: "cx:ns:d" },
      { text: "Codex CLI", callback_data: "cx:ns:c" }
    ],
    [
      { text: "Отмена", callback_data: "w:x" }
    ]
  ]);
}

export function inlineApprovalKeyboard(approvalId: string, nonce?: string) {
  return {
    inline_keyboard: [
      [
        { text: "Разрешить один раз", callback_data: approvalCallbackData("o", approvalId, nonce) }
      ],
      [
        { text: "Разрешить на фазу", callback_data: approvalCallbackData("p", approvalId, nonce) },
        { text: "Разрешить на сессию", callback_data: approvalCallbackData("s", approvalId, nonce) }
      ],
      [
        { text: "Отклонить", callback_data: approvalCallbackData("d", approvalId, nonce) },
        { text: "Подробнее", callback_data: `a:x:${approvalId}` }
      ]
    ]
  };
}

function hostStatusLabel(status: Host["status"]): string {
  switch (status) {
    case "active":
      return "online";
    case "paired":
      return "paired";
    case "stale":
      return "offline";
    case "registering":
      return "pairing";
    case "revoked":
    default:
      return status;
  }
}

function approvalActionLabel(actionKind: string): string {
  switch (actionKind) {
    case "workspace_write":
      return "изменить файлы в repo";
    case "workspace_write_outside_root":
      return "затронуть путь вне repo";
    case "git_push":
      return "отправить изменения наружу";
    case "verification_run":
      return "запустить verify";
    case "bootstrap_config_edit":
      return "изменить конфигурацию";
    case "bootstrap_install":
      return "выполнить bootstrap install";
    default:
      return actionKind;
  }
}

function riskLabel(risk: ApprovalRequest["risk"]): string {
  switch (risk) {
    case "low":
      return "низкий";
    case "medium":
      return "средний";
    case "high":
      return "высокий";
    case "critical":
      return "критический";
    default:
      return risk;
  }
}

function formatMainMenuText(overview?: MiniAppOverview): string {
  const activeSessions = overview?.sessions.filter(isActiveSession).length ?? 0;
  const waitingApprovals = overview?.approvals.filter(isWaitingApproval).length ?? 0;
  const problemSessions = overview?.sessions.filter((item) => item.state === "blocked" || item.state === "failed").length ?? 0;
  const unfinishedTasks = overview?.tasks.filter((item) => item.phase !== "complete" || item.verificationState === "stale").length ?? 0;
  const lastHost = overview?.hosts
    .slice()
    .sort((left, right) => (right.lastSeenAt ?? right.updatedAt).localeCompare(left.lastSeenAt ?? left.updatedAt))
    .at(0);
  const lastWorkspace = overview?.workspaces
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .at(0);

  return [
    "HappyTG",
    "Что делаем дальше?",
    "",
    `Активные сессии: ${activeSessions}`,
    `Ждут подтверждения: ${waitingApprovals}`,
    `Требуют внимания: ${problemSessions}`,
    `Незавершенные proof-задачи: ${unfinishedTasks}`,
    `Последний host/repo: ${lastHost ? lastHost.label : "нет"}${lastWorkspace ? ` / ${lastWorkspace.repoName}` : ""}`
  ].join("\n");
}

function formatFirstUseText(): string {
  return [
    "HappyTG",
    "Сначала подключите host, на котором лежит repo.",
    "",
    "На host выполните `pnpm daemon:pair`, затем пришлите сюда `/pair CODE`.",
    "После pairing я покажу меню с задачами, сессиями и approvals."
  ].join("\n");
}

function formatSessionCard(session: SessionDetail, overview?: MiniAppOverview): string {
  const host = overview?.hosts.find((item) => item.id === session.hostId);
  const workspace = overview?.workspaces.find((item) => item.id === session.workspaceId);
  const task = session.task ?? overview?.tasks.find((item) => item.id === session.taskId);
  const approval = session.approval ?? overview?.approvals.find((item) => item.id === session.approvalId);
  const flags = [
    approval && isWaitingApproval(approval) ? "approval" : undefined,
    task?.verificationState === "failed" || task?.verificationState === "inconclusive" ? "verify issue" : undefined,
    task?.verificationState === "stale" ? "stale verify" : undefined,
    session.state === "blocked" ? "blocked" : undefined
  ].filter(Boolean).join(", ") || "нет";

  return [
    `Сессия ${shortId(session.id)}`,
    trimLine(session.title, 80),
    "",
    `Host: ${host?.label ?? shortId(session.hostId)}`,
    `Repo: ${workspace?.repoName ?? shortId(session.workspaceId)}`,
    `Статус: ${session.state}`,
    `Фаза: ${task?.phase ?? (session.mode === "quick" ? "quick" : "preparing")}`,
    `Verify: ${task?.verificationState ?? "not_started"}`,
    `Внимание: ${flags}`,
    `Обновлено: ${session.updatedAt}`,
    session.currentSummary ? `\nКратко: ${trimLine(session.currentSummary, 160)}` : undefined,
    session.lastError ? `\nОшибка: ${trimLine(session.lastError, 160)}` : undefined
  ].filter(Boolean).join("\n");
}

function formatCodexMenuText(): string {
  return [
    "Codex",
    "Выберите источник задач и сессий.",
    "",
    "Codex CLI: HappyTG sessions через paired host.",
    "Codex Desktop: read-only local Desktop state через API adapter."
  ].join("\n");
}

function formatDesktopProjects(projects: CodexDesktopProject[]): string {
  if (projects.length === 0) {
    return "Codex Desktop projects не найдены или локальный Desktop state недоступен.";
  }

  return [
    "Codex Desktop projects",
    ...projects.slice(0, 8).map((project, index) => `${index + 1}. ${project.label}${project.active ? " (active)" : ""}\n   ${trimLine(project.path, 100)}`)
  ].join("\n");
}

function formatDesktopSessions(sessions: CodexDesktopSession[]): string {
  if (sessions.length === 0) {
    return "Codex Desktop sessions не найдены или локальный Desktop state недоступен.";
  }

  return [
    "Codex Desktop sessions",
    ...sessions.slice(0, 8).map((session, index) => `${index + 1}. ${trimLine(session.title, 70)} - ${session.status}`)
  ].join("\n");
}

function formatDesktopSessionCard(session: CodexDesktopSession): string {
  return [
    `Codex Desktop session ${shortId(session.id)}`,
    trimLine(session.title, 80),
    "",
    "Источник: Codex Desktop",
    `Статус: ${session.status}`,
    `Project: ${session.projectPath ? trimLine(session.projectPath, 110) : "unknown"}`,
    `Обновлено: ${session.updatedAt}`,
    `Resume: ${session.canResume ? "supported" : "unsupported"}`,
    `Stop: ${session.canStop ? "supported" : "unsupported"}`,
    !session.canResume || !session.canStop || !session.canCreateTask ? `Причина: ${trimLine(session.unsupportedReason ?? "contract unavailable", 160)}` : undefined
  ].filter(Boolean).join("\n");
}

function desktopProjectsKeyboard(projects: CodexDesktopProject[], miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "codex", { source: "codex-desktop" });
  return inlineKeyboard([
    ...projects.slice(0, 8).map((project) => [
      { text: project.label, callback_data: "cd:s" }
    ]),
    miniAppButton ? [miniAppButton] : [],
    [{ text: "Назад", callback_data: "cx:m" }]
  ]);
}

function desktopSessionsKeyboard(sessions: CodexDesktopSession[], miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "codex", { source: "codex-desktop" });
  return inlineKeyboard([
    ...sessions.slice(0, 8).map((session) => [
      { text: `Открыть ${shortId(session.id)}`, callback_data: `cd:u:${desktopSessionCallbackRef(session.id)}` }
    ]),
    miniAppButton ? [miniAppButton] : [],
    [{ text: "Назад", callback_data: "cx:m" }]
  ]);
}

function desktopSessionKeyboard(session: CodexDesktopSession, miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Открыть Mini App", miniBaseUrl, "codex-session", { id: session.id });
  const callbackRef = desktopSessionCallbackRef(session.id);
  return inlineKeyboard([
    session.canResume ? [{ text: "Resume", callback_data: `cd:r:${callbackRef}` }] : [],
    session.canStop ? [{ text: "Stop", callback_data: `cd:x:${callbackRef}` }] : [],
    miniAppButton ? [miniAppButton] : [],
    [{ text: "Desktop sessions", callback_data: "cd:s" }, { text: "Назад", callback_data: "cx:m" }]
  ]);
}

function sessionCardKeyboard(session: Session, miniBaseUrl: string | undefined): Record<string, unknown> {
  const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "session", { id: session.id });
  return inlineKeyboard([
      [
        { text: "Кратко", callback_data: `s:u:${session.id}` },
        { text: "Resume", callback_data: `s:r:${session.id}` }
      ],
      [
        { text: "Diff", callback_data: `s:d:${session.id}` },
        { text: "Verify", callback_data: `s:v:${session.id}` }
      ],
      miniAppButton ? [miniAppButton] : []
  ]);
}

function formatApprovalDialog(approval: ApprovalRequest, session?: Session): string {
  return [
    `Подтверждение ${shortId(approval.id)}`,
    "",
    `Что: ${approvalActionLabel(approval.actionKind)}`,
    `Зачем: ${approval.reason}`,
    `Риск: ${riskLabel(approval.risk)}`,
    `Scope сейчас: ${approval.scope ?? "once"}`,
    `Истекает: ${approval.expiresAt}`,
    session ? `Сессия: ${trimLine(session.title, 80)}` : undefined
  ].filter(Boolean).join("\n");
}

function formatHosts(hosts: Host[]): string {
  if (hosts.length === 0) {
    return [
      "Хостов пока нет.",
      "На execution host выполните `pnpm daemon:pair`, затем пришлите сюда `/pair CODE`."
    ].join("\n");
  }

  return [
    "Хосты",
    ...hosts.map((host) => [
      `- ${host.label}`,
      `  id: ${shortId(host.id)}`,
      `  status: ${hostStatusLabel(host.status)}`,
      host.lastSeenAt ? `  heartbeat: ${host.lastSeenAt}` : undefined
    ].filter(Boolean).join("\n"))
  ].join("\n");
}

function hostSelectionKeyboard(hosts: Host[]): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...hosts.slice(0, 8).map((host) => [
        { text: `${host.label} (${hostStatusLabel(host.status)})`, callback_data: `w:h:${host.id}` }
      ]),
      [
        { text: "Отмена", callback_data: "w:x" }
      ]
    ]
  };
}

function workspaceSelectionKeyboard(workspaces: Workspace[]): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...workspaces.slice(0, 8).map((workspace) => [
        { text: workspace.repoName, callback_data: `w:w:${workspace.id}` }
      ]),
      [
        { text: "Назад", callback_data: "w:b" },
        { text: "Отмена", callback_data: "w:x" }
      ]
    ]
  };
}

function modeSelectionKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "Быстрый вопрос", callback_data: "w:m:q" },
        { text: "Proof-loop задача", callback_data: "w:m:p" }
      ],
      [
        { text: "Назад", callback_data: "w:b" },
        { text: "Отмена", callback_data: "w:x" }
      ]
    ]
  };
}

function confirmTaskKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "Запустить", callback_data: "w:c" },
        { text: "Отмена", callback_data: "w:x" }
      ]
    ]
  };
}

function formatDraftConfirmation(draft: TaskWizardDraft): string {
  return [
    "Проверим перед запуском.",
    "",
    `Host: ${draft.hostLabel ?? draft.hostId}`,
    `Repo: ${draft.workspaceLabel ?? draft.workspaceId}`,
    `Режим: ${draft.mode === "proof" ? "proof-loop" : "быстрый"}`,
    `Задача: ${trimLine(draft.prompt ?? "", 180)}`
  ].join("\n");
}

function formatRecoveryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/pairing code not found/i.test(message)) {
    return "Не нашел такой pairing code. Запросите новый через `pnpm daemon:pair` и пришлите его сюда.";
  }
  if (/pairing code expired/i.test(message)) {
    return "Pairing code истек. Запросите свежий через `pnpm daemon:pair`.";
  }
  if (/nonce mismatch/i.test(message)) {
    return "Это подтверждение устарело. Откройте актуальный список approvals.";
  }
  if (/already/i.test(message) && /approval/i.test(message)) {
    return "Это подтверждение уже обработано. Откройте approvals, если нужно проверить состояние.";
  }
  return `Не получилось выполнить действие: ${message}`;
}

export function createBotHandlers(dependencies: BotDependencies) {
  const miniBaseUrl = dependencies.miniAppBaseUrl ?? resolveMiniAppBaseUrl().url;
  const now = dependencies.now ?? (() => Date.now());
  const wizardDrafts = new Map<string, TaskWizardDraft>();

  const resolveInternalUserId = dependencies.resolveInternalUserId ?? (async (user: TelegramUser) => {
    try {
      const result = await dependencies.apiFetch<{ id: string }>(`/api/v1/users/by-telegram/${user.id}`);
      return result.id;
    } catch {
      return undefined;
    }
  });

  function draftKey(user: TelegramUser): string {
    return String(user.id);
  }

  function getFreshDraft(user: TelegramUser): TaskWizardDraft | undefined {
    const key = draftKey(user);
    const draft = wizardDrafts.get(key);
    if (!draft) {
      return undefined;
    }
    if (now() - draft.updatedAt > DRAFT_TTL_MS) {
      wizardDrafts.delete(key);
      return undefined;
    }
    return draft;
  }

  function sweepExpiredDrafts(): number {
    const cutoff = now() - DRAFT_TTL_MS;
    let removed = 0;
    for (const [key, draft] of wizardDrafts.entries()) {
      if (draft.updatedAt <= cutoff) {
        wizardDrafts.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async function sendOrEdit(callback: TelegramCallbackQuery, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
    if (dependencies.editTelegramMessage && callback.message) {
      await dependencies.editTelegramMessage(callback.message.chat.id, callback.message.message_id, text, replyMarkup);
      return;
    }

    await dependencies.sendTelegramMessage(callback.message?.chat.id ?? callback.from.id, text, replyMarkup);
  }

  async function resolveUserOrPrompt(chatId: number, user?: TelegramUser): Promise<string | undefined> {
    if (!user) {
      await dependencies.sendTelegramMessage(chatId, "Telegram не передал данные пользователя. Повторите действие из личного чата с ботом.");
      return undefined;
    }

    const userId = await resolveInternalUserId(user);
    if (!userId) {
      await dependencies.sendTelegramMessage(chatId, formatFirstUseText(), mainMenuKeyboard(miniBaseUrl));
      return undefined;
    }

    return userId;
  }

  async function fetchOverview(userId: string): Promise<MiniAppOverview> {
    return dependencies.apiFetch<MiniAppOverview>(`/api/v1/miniapp/bootstrap?userId=${encodeURIComponent(userId)}`);
  }

  async function fetchHosts(userId: string): Promise<Host[]> {
    const result = await dependencies.apiFetch<{ hosts: Host[] }>(`/api/v1/hosts?userId=${encodeURIComponent(userId)}`);
    return result.hosts;
  }

  async function fetchWorkspaces(hostId: string, userId: string): Promise<Workspace[]> {
    const result = await dependencies.apiFetch<{ workspaces: Workspace[] }>(`/api/v1/hosts/${encodeURIComponent(hostId)}/workspaces?userId=${encodeURIComponent(userId)}`);
    return result.workspaces;
  }

  async function fetchDesktopProjects(userId: string): Promise<CodexDesktopProject[]> {
    const result = await dependencies.apiFetch<{ projects: CodexDesktopProject[] }>(`/api/v1/codex-desktop/projects?userId=${encodeURIComponent(userId)}`);
    return result.projects;
  }

  async function fetchDesktopSessions(userId: string): Promise<CodexDesktopSession[]> {
    const result = await dependencies.apiFetch<{ sessions: CodexDesktopSession[] }>(`/api/v1/codex-desktop/sessions?userId=${encodeURIComponent(userId)}`);
    return result.sessions;
  }

  async function handleMenu(message: TelegramMessage): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, formatFirstUseText(), mainMenuKeyboard(miniBaseUrl));
      return;
    }

    const userId = await resolveInternalUserId(message.from);
    if (!userId) {
      await dependencies.sendTelegramMessage(message.chat.id, formatFirstUseText(), mainMenuKeyboard(miniBaseUrl));
      return;
    }

    await dependencies.sendTelegramMessage(message.chat.id, formatMainMenuText(await fetchOverview(userId)), mainMenuKeyboard(miniBaseUrl));
  }

  async function handleHelp(message: TelegramMessage): Promise<void> {
    await dependencies.sendTelegramMessage(
      message.chat.id,
      [
        "HappyTG управляется кнопками.",
        "",
        "Полезные команды:",
        "/menu - главное меню",
        "/task - мастер новой задачи",
        "/sessions - активные сессии",
        "/approve - подтверждения",
        "/hosts - подключенные hosts",
        "/pair CODE - подключить host"
      ].join("\n"),
      mainMenuKeyboard(miniBaseUrl)
    );
  }

  async function handlePair(message: TelegramMessage, pairingCode: string): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram не передал данные пользователя. Откройте личный чат с ботом и повторите pairing.");
      return;
    }

    const result = await dependencies.apiFetch<{ user: { id: string; displayName: string }; host: { id: string; label: string } }>("/api/v1/pairing/claim", {
      method: "POST",
      body: JSON.stringify({
        pairingCode,
        telegramUserId: String(message.from.id),
        chatId: String(message.chat.id),
        username: message.from.username,
        displayName: userDisplayName(message.from)
      })
    });

    await dependencies.sendTelegramMessage(
      message.chat.id,
      [
        `Host подключен: ${result.host.label}.`,
        "Теперь можно запускать задачи и смотреть сессии из меню."
      ].join("\n"),
      mainMenuKeyboard(miniBaseUrl)
    );
  }

  async function handleHosts(message: TelegramMessage): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const hosts = await fetchHosts(userId);
    await dependencies.sendTelegramMessage(message.chat.id, formatHosts(hosts), hostSelectionKeyboard(hosts));
  }

  async function handleSessions(message: TelegramMessage): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const overview = await fetchOverview(userId);
    const sessions = overview.sessions.filter(isActiveSession).slice(0, 5);
    if (sessions.length === 0) {
      const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "sessions");
      await dependencies.sendTelegramMessage(
        message.chat.id,
        "Активных сессий нет. Можно начать новую задачу.",
        inlineKeyboard([
          [{ text: "Новая задача", callback_data: "m:t" }],
          miniAppButton ? [miniAppButton] : []
        ])
      );
      return;
    }

    const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "sessions");
    await dependencies.sendTelegramMessage(
      message.chat.id,
      ["Активные сессии", ...sessions.map((session, index) => `${index + 1}. ${trimLine(session.title, 70)} - ${session.state}`)].join("\n"),
      inlineKeyboard([
        ...sessions.map((session) => [
          { text: `Открыть ${shortId(session.id)}`, callback_data: `s:u:${session.id}` }
        ]),
        miniAppButton ? [miniAppButton] : []
      ])
    );
  }

  async function handleCodexMenu(chatId: number): Promise<void> {
    await dependencies.sendTelegramMessage(chatId, formatCodexMenuText(), codexMenuKeyboard(miniBaseUrl));
  }

  async function handleDesktopProjects(message: TelegramMessage): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const projects = await fetchDesktopProjects(userId);
    await dependencies.sendTelegramMessage(message.chat.id, formatDesktopProjects(projects), desktopProjectsKeyboard(projects, miniBaseUrl));
  }

  async function handleDesktopSessions(message: TelegramMessage): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const sessions = await fetchDesktopSessions(userId);
    await dependencies.sendTelegramMessage(message.chat.id, formatDesktopSessions(sessions), desktopSessionsKeyboard(sessions, miniBaseUrl));
  }

  async function findDesktopSessionByRef(userId: string, sessionRef: string): Promise<CodexDesktopSession | undefined> {
    return (await fetchDesktopSessions(userId)).find((item) => desktopSessionMatchesRef(item, sessionRef));
  }

  async function sendDesktopSessionCard(chatId: number, sessionRef: string, user?: TelegramUser): Promise<void> {
    const userId = await resolveUserOrPrompt(chatId, user);
    if (!userId) {
      return;
    }

    const session = await findDesktopSessionByRef(userId, sessionRef);
    if (!session) {
      await dependencies.sendTelegramMessage(chatId, "Codex Desktop session не найдена.", codexMenuKeyboard(miniBaseUrl));
      return;
    }

    await dependencies.sendTelegramMessage(chatId, formatDesktopSessionCard(session), desktopSessionKeyboard(session, miniBaseUrl));
  }

  async function sendSessionCard(chatId: number, sessionId: string, user?: TelegramUser): Promise<void> {
    const session = await dependencies.apiFetch<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
    const userId = user ? await resolveInternalUserId(user) : undefined;
    const overview = userId ? await fetchOverview(userId) : undefined;
    await dependencies.sendTelegramMessage(chatId, formatSessionCard(session, overview), sessionCardKeyboard(session, miniBaseUrl));
  }

  async function handleApprovals(message: TelegramMessage): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const result = await dependencies.apiFetch<{ approvals: ApprovalRequest[] }>(`/api/v1/approvals?userId=${encodeURIComponent(userId)}&state=waiting_human,pending`);
    if (result.approvals.length === 0) {
      const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "approvals");
      await dependencies.sendTelegramMessage(
        message.chat.id,
        "Подтверждений сейчас нет.",
        inlineKeyboard([
          [{ text: "Активные сессии", callback_data: "m:s" }],
          miniAppButton ? [miniAppButton] : []
        ])
      );
      return;
    }

    const miniAppButton = telegramWebAppButton("Mini App", miniBaseUrl, "approvals");
    await dependencies.sendTelegramMessage(
      message.chat.id,
      `Ждут решения: ${result.approvals.length}. Откройте нужное подтверждение.`,
      inlineKeyboard([
        ...result.approvals.slice(0, 8).map((approval) => [
          { text: `${approvalActionLabel(approval.actionKind)} (${riskLabel(approval.risk)})`, callback_data: `a:x:${approval.id}` }
        ]),
        miniAppButton ? [miniAppButton] : []
      ])
    );
  }

  async function startTaskWizard(chatId: number, user?: TelegramUser): Promise<void> {
    sweepExpiredDrafts();
    const userId = await resolveUserOrPrompt(chatId, user);
    if (!userId || !user) {
      return;
    }

    wizardDrafts.set(draftKey(user), {
      userId,
      chatId,
      updatedAt: now()
    });

    await dependencies.sendTelegramMessage(chatId, "Выберите runtime/source для новой задачи.", runtimeSelectionKeyboard());
  }

  async function startCliTaskWizard(chatId: number, user?: TelegramUser): Promise<void> {
    sweepExpiredDrafts();
    const userId = await resolveUserOrPrompt(chatId, user);
    if (!userId || !user) {
      return;
    }

    const hosts = await fetchHosts(userId);
    if (hosts.length === 0) {
      await dependencies.sendTelegramMessage(chatId, "Сначала подключите host через `pnpm daemon:pair` и `/pair CODE`.", mainMenuKeyboard(miniBaseUrl));
      return;
    }

    wizardDrafts.set(draftKey(user), {
      userId,
      chatId,
      runtime: "codex-cli",
      updatedAt: now()
    });

    if (hosts.length === 1) {
      await chooseWizardHost(chatId, user, hosts[0]!.id, hosts[0]);
      return;
    }

    await dependencies.sendTelegramMessage(chatId, "Выберите host для новой задачи.", hostSelectionKeyboard(hosts));
  }

  async function startDesktopTaskWizard(chatId: number, user?: TelegramUser): Promise<void> {
    const userId = await resolveUserOrPrompt(chatId, user);
    if (!userId) {
      return;
    }

    const [projects, sessions] = await Promise.all([
      fetchDesktopProjects(userId),
      fetchDesktopSessions(userId)
    ]);
    const canCreateTask = sessions.some((session) => session.canCreateTask);
    if (!canCreateTask) {
      const reason = sessions[0]?.unsupportedReason ?? "Stable Codex Desktop New Task contract is unavailable.";
      await dependencies.sendTelegramMessage(
        chatId,
        [
          "New Desktop Task сейчас недоступен.",
          trimLine(reason, 180),
          "",
          projects.length > 0 ? `Desktop projects видны: ${projects.length}.` : "Desktop projects не найдены."
        ].join("\n"),
        inlineKeyboard([
          [{ text: "Desktop sessions", callback_data: "cd:s" }],
          [{ text: "Назад", callback_data: "cx:m" }]
        ])
      );
      return;
    }

    await dependencies.sendTelegramMessage(chatId, "Codex Desktop New Task поддержан adapter contract. Откройте Mini App для выбора проекта и подтверждения.", codexMenuKeyboard(miniBaseUrl));
  }

  async function chooseWizardHost(chatId: number, user: TelegramUser, hostId: string, knownHost?: Host): Promise<void> {
    const draft = getFreshDraft(user);
    if (!draft) {
      await startTaskWizard(chatId, user);
      return;
    }

    const host = knownHost ?? (await fetchHosts(draft.userId)).find((item) => item.id === hostId);
    if (!host) {
      await dependencies.sendTelegramMessage(chatId, "Host больше недоступен. Откройте список hosts и выберите заново.");
      return;
    }

    draft.hostId = host.id;
    draft.hostLabel = host.label;
    draft.updatedAt = now();

    const workspaces = await fetchWorkspaces(host.id, draft.userId);
    if (workspaces.length === 0) {
      await dependencies.sendTelegramMessage(chatId, "На этом host пока нет доступных repos. Запустите daemon, чтобы он отправил hello с workspace list.");
      return;
    }

    if (workspaces.length === 1) {
      await chooseWizardWorkspace(chatId, user, workspaces[0]!.id, workspaces[0]);
      return;
    }

    await dependencies.sendTelegramMessage(chatId, `Host: ${host.label}. Теперь выберите repo.`, workspaceSelectionKeyboard(workspaces));
  }

  async function chooseWizardWorkspace(chatId: number, user: TelegramUser, workspaceId: string, knownWorkspace?: Workspace): Promise<void> {
    const draft = getFreshDraft(user);
    if (!draft?.hostId) {
      await startTaskWizard(chatId, user);
      return;
    }

    const workspace = knownWorkspace ?? (await fetchWorkspaces(draft.hostId, draft.userId)).find((item) => item.id === workspaceId);
    if (!workspace) {
      await dependencies.sendTelegramMessage(chatId, "Repo больше недоступен. Выберите repo заново.");
      return;
    }

    draft.workspaceId = workspace.id;
    draft.workspaceLabel = workspace.repoName;
    draft.updatedAt = now();

    await dependencies.sendTelegramMessage(
      chatId,
      `Repo: ${workspace.repoName}. Выберите режим.`,
      modeSelectionKeyboard()
    );
  }

  async function chooseWizardMode(chatId: number, user: TelegramUser, modeCode: string): Promise<void> {
    const draft = getFreshDraft(user);
    if (!draft?.workspaceId) {
      await startTaskWizard(chatId, user);
      return;
    }

    draft.mode = modeCode === "p" ? "proof" : "quick";
    draft.updatedAt = now();
    await dependencies.sendTelegramMessage(
      chatId,
      draft.mode === "proof"
        ? "Опишите задачу одним сообщением. Я запущу proof-loop: freeze, build, evidence, fresh verify."
        : "Напишите быстрый вопрос или короткую задачу одним сообщением."
    );
  }

  async function captureWizardPrompt(message: TelegramMessage): Promise<boolean> {
    if (!message.from || !message.text || message.text.startsWith("/")) {
      return false;
    }

    const draft = getFreshDraft(message.from);
    if (!draft?.mode || !draft.workspaceId) {
      return false;
    }

    draft.prompt = message.text.trim();
    draft.updatedAt = now();
    await dependencies.sendTelegramMessage(message.chat.id, formatDraftConfirmation(draft), confirmTaskKeyboard());
    return true;
  }

  async function confirmWizard(chatId: number, user: TelegramUser): Promise<void> {
    const draft = getFreshDraft(user);
    if (!draft?.hostId || !draft.workspaceId || !draft.mode || !draft.prompt || draft.runtime !== "codex-cli") {
      await dependencies.sendTelegramMessage(chatId, "Черновик задачи устарел. Начните заново через /task.", mainMenuKeyboard(miniBaseUrl));
      return;
    }

    const titlePrefix = draft.mode === "proof" ? "Proof task" : "Quick task";
    const payload: CreateSessionRequest = {
      userId: draft.userId,
      hostId: draft.hostId,
      workspaceId: draft.workspaceId,
      mode: draft.mode,
      runtime: "codex-cli",
      title: `${titlePrefix}: ${trimLine(draft.prompt, 48)}`,
      prompt: draft.prompt,
      acceptanceCriteria: draft.mode === "proof"
        ? [
          "Frozen scope matches the Telegram instruction",
          "Implementation evidence is written to the repo proof bundle",
          "Fresh verifier pass is recorded"
        ]
        : undefined
    };

    const result = await dependencies.apiFetch<{
      session: Session;
      task?: TaskBundle;
      approval?: ApprovalRequest;
      dispatch?: { id: string };
    }>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    wizardDrafts.delete(draftKey(user));

    if (result.approval) {
      await dependencies.sendTelegramMessage(
        chatId,
        [
          `Сессия создана: ${shortId(result.session.id)}.`,
          "Для продолжения нужно подтверждение."
        ].join("\n")
      );
      await dependencies.sendTelegramMessage(chatId, formatApprovalDialog(result.approval, result.session), inlineApprovalKeyboard(result.approval.id, result.approval.nonce));
      return;
    }

    await dependencies.sendTelegramMessage(chatId, formatSessionCard({ ...result.session, task: result.task }), sessionCardKeyboard(result.session, miniBaseUrl));
  }

  async function handleApprovalCommand(message: TelegramMessage, approvalId: string, decisionWord: string, reason?: string): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const decision = decisionWord === "approve" ? "approved" : "rejected";
    const payload: ResolveApprovalRequest = {
      userId,
      decision,
      scope: "once",
      reason
    };
    const result = await dependencies.apiFetch<{ approval: ApprovalRequest; session: Session }>(`/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    await dependencies.sendTelegramMessage(message.chat.id, `Готово: approval ${shortId(result.approval.id)} -> ${result.approval.state}. Сессия -> ${result.session.state}.`);
  }

  async function handleSessionCommand(message: TelegramMessage, parts: string[]): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const mode = parts[0];
    if (mode !== "quick" && mode !== "proof") {
      await dependencies.sendTelegramMessage(message.chat.id, "Используйте /task для мастера или /session quick|proof ... для power-user запуска.");
      return;
    }

    const [hostId, workspaceId, ...rest] = parts.slice(1);
    const joined = rest.join(" ").trim();
    if (!hostId || !workspaceId || !joined) {
      await dependencies.sendTelegramMessage(message.chat.id, "Для ручного запуска нужны host, repo и текст задачи. Проще открыть /task.");
      return;
    }

    const payload: CreateSessionRequest = {
      userId,
      hostId,
      workspaceId,
      mode,
      runtime: "codex-cli",
      title: `${mode === "proof" ? "Proof task" : "Quick task"}: ${trimLine(joined, 48)}`,
      prompt: joined,
      acceptanceCriteria: mode === "proof" ? ["Prompt satisfied", "Independent verifier passed"] : undefined
    };
    const result = await dependencies.apiFetch<{ session: Session; task?: TaskBundle; approval?: ApprovalRequest }>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.approval) {
      await dependencies.sendTelegramMessage(message.chat.id, formatApprovalDialog(result.approval, result.session), inlineApprovalKeyboard(result.approval.id, result.approval.nonce));
      return;
    }

    await dependencies.sendTelegramMessage(message.chat.id, formatSessionCard({ ...result.session, task: result.task }), sessionCardKeyboard(result.session, miniBaseUrl));
  }

  async function handleBootstrapCommand(message: TelegramMessage, hostId: string, command: "doctor" | "verify"): Promise<void> {
    const userId = await resolveUserOrPrompt(message.chat.id, message.from);
    if (!userId) {
      return;
    }

    const result = await dependencies.apiFetch<{
      session: Session;
      approval?: ApprovalRequest;
    }>(`/api/v1/hosts/${encodeURIComponent(hostId)}/bootstrap/${command}`, {
      method: "POST",
      body: JSON.stringify({ userId })
    });

    if (result.approval) {
      await dependencies.sendTelegramMessage(message.chat.id, formatApprovalDialog(result.approval, result.session), inlineApprovalKeyboard(result.approval.id, result.approval.nonce));
      return;
    }

    await dependencies.sendTelegramMessage(message.chat.id, formatSessionCard(result.session), sessionCardKeyboard(result.session, miniBaseUrl));
  }

  async function dispatchMessage(message: TelegramMessage): Promise<void> {
    sweepExpiredDrafts();
    const text = message.text?.trim();
    if (!text) {
      return;
    }

    if (await captureWizardPrompt(message)) {
      return;
    }

    const [command, ...rest] = text.split(" ");
    switch (command) {
      case "/start":
      case "/menu":
        await handleMenu(message);
        return;
      case "/help":
        await handleHelp(message);
        return;
      case "/task":
        await startTaskWizard(message.chat.id, message.from);
        return;
      case "/codex":
        await handleCodexMenu(message.chat.id);
        return;
      case "/pair":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Пришлите pairing code так: `/pair CODE`.");
          return;
        }
        await handlePair(message, rest[0]);
        return;
      case "/hosts":
        await handleHosts(message);
        return;
      case "/sessions":
        await handleSessions(message);
        return;
      case "/status":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Пришлите session id или откройте /sessions.");
          return;
        }
        await sendSessionCard(message.chat.id, rest[0], message.from);
        return;
      case "/resume":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Пришлите session id или откройте /sessions.");
          return;
        }
        await dependencies.apiFetch(`/api/v1/sessions/${encodeURIComponent(rest[0])}/resume`, { method: "POST" });
        await sendSessionCard(message.chat.id, rest[0], message.from);
        return;
      case "/doctor":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Выберите host через /hosts или передайте id: /doctor HOST_ID.");
          return;
        }
        await handleBootstrapCommand(message, rest[0], "doctor");
        return;
      case "/verify":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Выберите host через /hosts или передайте id: /verify HOST_ID.");
          return;
        }
        await handleBootstrapCommand(message, rest[0], "verify");
        return;
      case "/approve":
        if (!rest[0]) {
          await handleApprovals(message);
          return;
        }
        if (!rest[1]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Формат: /approve APPROVAL_ID approve|reject. Для списка используйте /approve.");
          return;
        }
        await handleApprovalCommand(message, rest[0], rest[1], rest.slice(2).join(" "));
        return;
      case "/session":
        await handleSessionCommand(message, rest);
        return;
      default:
        await dependencies.sendTelegramMessage(message.chat.id, "Я не знаю такую команду. Откройте меню и выберите действие кнопкой.", mainMenuKeyboard(miniBaseUrl));
    }
  }

  function parseApprovalCallback(data: string): { approvalId: string; scope?: ApprovalScope; decision: "approved" | "rejected"; nonce?: string; detailsOnly?: boolean } | undefined {
    const [prefix, action, approvalId, nonce] = data.split(":");
    if (prefix === "a" && approvalId) {
      if (action === "x") {
        return { approvalId, decision: "approved", detailsOnly: true };
      }
      const scope = action === "p" ? "phase" : action === "s" ? "session" : "once";
      return {
        approvalId,
        decision: action === "d" ? "rejected" : "approved",
        scope,
        nonce
      };
    }

    if (prefix === "approval" && approvalId) {
      return {
        approvalId,
        decision: action === "approve" ? "approved" : "rejected",
        scope: "once"
      };
    }

    return undefined;
  }

  async function handleApprovalCallback(callback: TelegramCallbackQuery, parsed: NonNullable<ReturnType<typeof parseApprovalCallback>>): Promise<void> {
    if (parsed.detailsOnly) {
      const approval = await dependencies.apiFetch<ApprovalRequest>(`/api/v1/approvals/${encodeURIComponent(parsed.approvalId)}`);
      await sendOrEdit(callback, formatApprovalDialog(approval), inlineApprovalKeyboard(approval.id, approval.nonce));
      return;
    }

    const userId = await resolveUserOrPrompt(callback.message?.chat.id ?? callback.from.id, callback.from);
    if (!userId) {
      return;
    }

    const payload: ResolveApprovalRequest = {
      userId,
      decision: parsed.decision,
      scope: parsed.scope,
      nonce: parsed.nonce
    };
    const result = await dependencies.apiFetch<{ approval: ApprovalRequest; session: Session }>(`/api/v1/approvals/${encodeURIComponent(parsed.approvalId)}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    await sendOrEdit(callback, `Готово: approval ${shortId(result.approval.id)} -> ${result.approval.state}. Сессия -> ${result.session.state}.`, sessionCardKeyboard(result.session, miniBaseUrl));
  }

  async function handleSessionCallback(callback: TelegramCallbackQuery, action: string, sessionId: string): Promise<void> {
    const chatId = callback.message?.chat.id ?? callback.from.id;
    if (action === "r") {
      await dependencies.apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/resume`, { method: "POST" });
    }

    if (action === "d" || action === "v") {
      const miniAppButton = telegramWebAppButton(
        "Открыть Mini App",
        miniBaseUrl,
        action === "d" ? "diff" : "verify",
        { sessionId }
      );
      await sendOrEdit(
        callback,
        miniAppButton
          ? action === "d"
            ? "Большой diff удобнее смотреть в Mini App."
            : "Verify details удобнее смотреть в Mini App."
          : miniAppUnavailableText(),
        inlineKeyboard([
          miniAppButton ? [miniAppButton] : [],
          [{ text: "К карточке сессии", callback_data: `s:u:${sessionId}` }]
        ])
      );
      return;
    }

    const session = await dependencies.apiFetch<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
    const userId = await resolveInternalUserId(callback.from);
    const overview = userId ? await fetchOverview(userId) : undefined;
    await sendOrEdit(callback, formatSessionCard(session, overview), sessionCardKeyboard(session, miniBaseUrl));
  }

  async function dispatchCallback(callback: TelegramCallbackQuery): Promise<void> {
    sweepExpiredDrafts();
    const data = callback.data ?? "";
    const chatId = callback.message?.chat.id ?? callback.from.id;
    const [prefix, action, ...rest] = data.split(":");
    const value = rest.join(":");

    const approvalCallback = parseApprovalCallback(data);
    if (approvalCallback) {
      await handleApprovalCallback(callback, approvalCallback);
      return;
    }

    if (prefix === "cx") {
      if (action === "m") {
        await sendOrEdit(callback, formatCodexMenuText(), codexMenuKeyboard(miniBaseUrl));
        return;
      }
      if (action === "c") {
        await handleSessions({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "d") {
        await handleDesktopSessions({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "ns" && value === "c") {
        await startCliTaskWizard(chatId, callback.from);
        return;
      }
      if (action === "ns" && value === "d") {
        await startDesktopTaskWizard(chatId, callback.from);
        return;
      }
    }

    if (prefix === "cc" && action === "s") {
      await handleSessions({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
      return;
    }

    if (prefix === "cd") {
      if (action === "p") {
        await handleDesktopProjects({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "s") {
        await handleDesktopSessions({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "u" && value) {
        await sendDesktopSessionCard(chatId, value, callback.from);
        return;
      }
      if ((action === "r" || action === "x") && value) {
        const userId = await resolveUserOrPrompt(chatId, callback.from);
        if (!userId) {
          return;
        }
        const session = await findDesktopSessionByRef(userId, value);
        if (!session) {
          await sendOrEdit(callback, "Codex Desktop session не найдена.", codexMenuKeyboard(miniBaseUrl));
          return;
        }
        await dependencies.apiFetch(`/api/v1/codex-desktop/sessions/${encodeURIComponent(session.id)}/${action === "r" ? "resume" : "stop"}`, {
          method: "POST",
          body: JSON.stringify({ userId })
        });
        await sendDesktopSessionCard(chatId, desktopSessionCallbackRef(session.id), callback.from);
        return;
      }
    }

    if (prefix === "m") {
      if (action === "t") {
        await startTaskWizard(chatId, callback.from);
        return;
      }
      if (action === "s") {
        await handleSessions({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "a") {
        await handleApprovals({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "h") {
        await handleHosts({ message_id: callback.message?.message_id ?? 0, chat: { id: chatId }, from: callback.from });
        return;
      }
      if (action === "r") {
        const miniAppButton = telegramWebAppButton("Открыть Mini App", miniBaseUrl, "reports");
        await sendOrEdit(
          callback,
          miniAppButton ? "Последние отчеты открываются в Mini App." : miniAppUnavailableText(),
          miniAppButton ? inlineKeyboard([[miniAppButton]]) : mainMenuKeyboard(miniBaseUrl)
        );
        return;
      }
    }

    if (prefix === "w") {
      if (action === "x") {
        wizardDrafts.delete(draftKey(callback.from));
        await sendOrEdit(callback, "Ок, задачу не запускаю.", mainMenuKeyboard(miniBaseUrl));
        return;
      }
      if (action === "b") {
        await startTaskWizard(chatId, callback.from);
        return;
      }
      if (action === "h" && value) {
        await chooseWizardHost(chatId, callback.from, value);
        return;
      }
      if (action === "w" && value) {
        await chooseWizardWorkspace(chatId, callback.from, value);
        return;
      }
      if (action === "m" && value) {
        await chooseWizardMode(chatId, callback.from, value);
        return;
      }
      if (action === "c") {
        await confirmWizard(chatId, callback.from);
        return;
      }
    }

    if (prefix === "s" && value) {
      await handleSessionCallback(callback, action, value);
      return;
    }
  }

  async function handleMessage(message: TelegramMessage): Promise<void> {
    try {
      await dispatchMessage(message);
    } catch (error) {
      await dependencies.sendTelegramMessage(message.chat.id, formatRecoveryMessage(error), mainMenuKeyboard(miniBaseUrl));
    }
  }

  async function handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    try {
      await dispatchCallback(callback);
    } catch (error) {
      await dependencies.sendTelegramMessage(callback.message?.chat.id ?? callback.from.id, formatRecoveryMessage(error), mainMenuKeyboard(miniBaseUrl));
    }
  }

  return {
    handleMessage,
    handleCallbackQuery,
    wizardDraftCount: () => wizardDrafts.size
  };
}
