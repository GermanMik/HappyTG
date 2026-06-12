import { fileURLToPath } from "node:url";

import {
  createJsonServer,
  createLogger,
  html,
  json,
  loadHappyTGEnv,
  readJsonBody,
  readPort,
  route,
  text,
  validatePublicHttpsUrl,
  type Logger
} from "../../../packages/shared/src/index.js";
import type {
  CodexDesktopControlResult,
  CodexDesktopControlStatus,
  CodexDesktopHistoryEntry,
  CodexDesktopProject,
  CodexDesktopSession,
  CodexDesktopSessionDetail,
  CreateSessionRequest,
  MiniAppApprovalCard,
  MiniAppDashboardProjection,
  MiniAppDiffProjection,
  MiniAppHostCard,
  MiniAppProjectCard,
  MiniAppReportCard,
  MiniAppSessionCard,
  MiniAppVerifyProjection,
  SessionEvent,
  TaskBundle,
  Workspace
} from "../../../packages/protocol/src/index.js";

const logger = createLogger("miniapp");
loadHappyTGEnv();
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const configuredBrowserApiBaseUrl = resolveBrowserApiBaseUrl();
const miniAppSessionCookieName = "happytg_miniapp_session";
const port = readPort(process.env, ["HAPPYTG_MINIAPP_PORT", "PORT"], 3001);

export interface MiniAppDependencies {
  fetchJson<T>(pathname: string, init?: RequestInit): Promise<T>;
}

export class MiniAppFetchError extends Error {
  constructor(
    readonly pathname: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(`Mini App fetch failed for ${pathname}: ${status}`);
  }
}

async function defaultFetchJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, apiBaseUrl), init);
  if (!response.ok) {
    const textBody = await response.text();
    let detail = textBody;
    try {
      const parsed = JSON.parse(textBody) as { detail?: unknown; error?: unknown; reason?: unknown };
      detail = String(parsed.detail ?? parsed.error ?? parsed.reason ?? textBody);
    } catch {
      detail = textBody;
    }
    throw new MiniAppFetchError(pathname, response.status, detail);
  }

  return (await response.json()) as T;
}

function resolveBrowserApiBaseUrl(env = process.env): string {
  const explicit = env.HAPPYTG_BROWSER_API_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const publicUrl = env.HAPPYTG_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      if (parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Fall back to the direct API URL below.
    }
  }

  return env.HAPPYTG_API_URL ?? "http://localhost:4000";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed.split(",")[0]?.trim() : undefined;
}

function resolveRequestOrigin(headers: Record<string, string | string[] | undefined>): string | undefined {
  const host = firstHeaderValue(headers["x-forwarded-host"]) ?? firstHeaderValue(headers.host);
  const proto = firstHeaderValue(headers["x-forwarded-proto"]) ?? "http";
  if (!host) {
    return undefined;
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return undefined;
  }
}

export function resolveBrowserApiBaseUrlForRequest(
  headers: Record<string, string | string[] | undefined>,
  env = process.env
): string {
  const explicit = env.HAPPYTG_BROWSER_API_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const basePath = normalizeBasePath(headers["x-forwarded-prefix"] ?? env.HAPPYTG_MINIAPP_BASE_PATH);
  const requestOrigin = resolveRequestOrigin(headers);
  if (basePath && requestOrigin && validatePublicHttpsUrl(requestOrigin, "Mini App request origin").ok) {
    return "";
  }

  return resolveBrowserApiBaseUrl(env);
}

function normalizeBasePath(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function prefixRootRelativeLinks(html: string, basePath: string): string {
  if (!basePath) {
    return html;
  }

  return html.replace(/href="\/(?!\/)/gu, `href="${basePath}/`);
}

function parseCookieHeader(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(";") : header;
  if (!raw) {
    return {};
  }

  return Object.fromEntries(raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator === -1) {
        return [item, ""];
      }

      return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
    }));
}

function miniAppSessionToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return parseCookieHeader(headers.cookie)[miniAppSessionCookieName];
}

const proofProgressSteps = [
  { phase: "quick", label: "Quick" },
  { phase: "freeze", label: "Freeze/Spec" },
  { phase: "build", label: "Build" },
  { phase: "evidence", label: "Evidence" },
  { phase: "verify", label: "Fresh Verify" },
  { phase: "fix", label: "Minimal Fix" },
  { phase: "complete", label: "Complete" }
] as const;

type BadgeTone = "neutral" | "info" | "success" | "warn" | "danger";
type NewTaskIntent = "implement" | "question" | "review";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toneForState(value: string): BadgeTone {
  const state = value.toLowerCase();
  if (["active", "approved", "completed", "complete", "passed", "ok", "paired"].some((token) => state.includes(token))) {
    return "success";
  }
  if (["warn", "pending", "running", "verifying", "created", "queued"].some((token) => state.includes(token))) {
    return "warn";
  }
  if (["fail", "failed", "error", "rejected", "cancelled", "revoked", "missing"].some((token) => state.includes(token))) {
    return "danger";
  }
  return "neutral";
}

function renderBadge(label: string, tone = toneForState(label)): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function compactDate(value: string | undefined): string {
  if (!value) {
    return "time n/a";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function compactPath(value: string | undefined): string {
  if (!value) {
    return "project n/a";
  }

  const parts = value.split(/[\\/]/u).filter(Boolean);
  return parts.length > 1 ? parts.slice(-2).join("/") : parts[0] ?? value;
}

function renderDetails(label: string, rows: Array<{ label: string; value?: string | number | boolean }>): string {
  const visibleRows = rows.filter((row) => row.value !== undefined && row.value !== "");
  if (visibleRows.length === 0) {
    return "";
  }

  return `<details class="meta-details">
    <summary>${escapeHtml(label)}</summary>
    <dl>${visibleRows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(String(row.value))}</dd></div>`).join("")}</dl>
  </details>`;
}

function sessionResultLabel(session: Pick<MiniAppSessionCard, "state" | "verificationState" | "attention">): string {
  if (session.attention === "approval") {
    return "Нужно решение";
  }
  if (session.verificationState === "passed") {
    return "PASS";
  }
  if (session.verificationState === "failed" || session.verificationState === "stale") {
    return "Нужна правка";
  }
  if (session.verificationState === "running" || session.state === "verifying") {
    return "Проверка";
  }
  if (session.state === "completed") {
    return "Готово";
  }
  if (session.state === "failed" || session.state === "cancelled") {
    return "Ошибка";
  }
  if (session.state === "blocked" || session.state === "needs_approval") {
    return "Блокер";
  }
  if (session.state === "running" || session.state === "resuming") {
    return "В работе";
  }
  return "Открыть";
}

function sessionResultTone(session: Pick<MiniAppSessionCard, "state" | "verificationState" | "attention">): BadgeTone {
  if (session.verificationState === "passed" || session.state === "completed") {
    return "success";
  }
  if (session.verificationState === "failed" || session.verificationState === "stale" || session.state === "failed" || session.state === "cancelled") {
    return "danger";
  }
  if (session.attention || session.state === "blocked" || session.state === "needs_approval") {
    return "warn";
  }
  if (session.state === "running" || session.state === "verifying" || session.state === "resuming") {
    return "info";
  }
  return "neutral";
}

function normalizeNewTaskIntent(value: unknown): NewTaskIntent {
  return value === "question" || value === "review" ? value : "implement";
}

function intentLabel(intent: NewTaskIntent): string {
  switch (intent) {
    case "question":
      return "Вопрос";
    case "review":
      return "Проверить результат";
    default:
      return "Реализовать";
  }
}

function defaultModeForIntent(intent: NewTaskIntent): "quick" | "proof" {
  return intent === "implement" ? "proof" : "quick";
}

function newTaskHref(input: {
  source?: string;
  hostId?: string;
  workspaceId?: string;
  projectId?: string;
  intent?: NewTaskIntent;
  title?: string;
  contextSessionId?: string;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/new-task?${query}` : "/new-task";
}

function buildMiniAppTaskPrompt(input: { intent?: unknown; prompt?: unknown; contextSessionId?: unknown }): string {
  const prompt = String(input.prompt ?? "").trim();
  const hasIntentContext = typeof input.intent === "string" || typeof input.contextSessionId === "string";
  if (!hasIntentContext) {
    return prompt;
  }

  const intent = normalizeNewTaskIntent(input.intent);
  const contextSessionId = String(input.contextSessionId ?? "").trim();
  const header = intent === "question"
    ? "Intent: implementation question."
    : intent === "review"
      ? "Intent: review the current implementation result."
      : "Intent: implementation task.";
  const context = contextSessionId ? `\nContext session: ${contextSessionId}.` : "";

  return `${header}${context}\n\n${prompt}`.trim();
}

function renderProofProgress(task: { phase: string; verificationState: string }, options?: { sessionState?: string }): string {
  const activePhase = task.verificationState === "running" || options?.sessionState === "verifying"
    ? "verify"
    : task.phase;
  const currentStepIndex = proofProgressSteps.findIndex((step) => step.phase === activePhase);
  const verificationBadge = renderBadge(task.verificationState);

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Proof Progress</h2>
        ${verificationBadge}
      </div>
      <ol class="progress-list">
        ${proofProgressSteps.map((step, index) => {
          const status = index < currentStepIndex
            ? "done"
            : index === currentStepIndex
              ? "current"
              : "pending";
          const statusLabel = status === "done" ? "done" : status === "current" ? "current" : "pending";
          return `<li class="progress-step progress-step-${status}">
            <span class="progress-marker">${index + 1}</span>
            <div>
              <strong>${escapeHtml(step.label)}</strong>
              <div class="muted">${statusLabel}</div>
            </div>
          </li>`;
        }).join("")}
      </ol>
    </section>
  `;
}

export function formatMiniAppPortConflictMessage(listenPort: number): string {
  return formatMiniAppPortConflictMessageDetailed(listenPort);
}

export function formatMiniAppPortReuseMessage(listenPort: number): string {
  return `Port ${listenPort} already has a HappyTG Mini App. Reuse the running mini app if it is yours, or start a new one with HAPPYTG_MINIAPP_PORT/PORT, then try again.`;
}

export function formatMiniAppPortConflictMessageDetailed(
  listenPort: number,
  options?: {
    service?: string;
    description?: string;
  }
): string {
  if (options?.service) {
    return `Port ${listenPort} is already in use by HappyTG ${options.service}, not HappyTG Mini App. Free it, or start the Mini App with HAPPYTG_MINIAPP_PORT/PORT, then try again.`;
  }

  if (options?.description) {
    return `Port ${listenPort} is already in use by ${options.description}. Free it, or start the Mini App with HAPPYTG_MINIAPP_PORT/PORT, then try again.`;
  }

  return `Port ${listenPort} is already in use by another process. Free it, or start the Mini App with HAPPYTG_MINIAPP_PORT/PORT, then try again.`;
}

export interface MiniAppStartupResult {
  status: "listening" | "reused";
  port: number;
}

interface PortOccupantInfo {
  service?: string;
  description?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function detectPortOccupant(listenPort: number, fetchImpl: typeof fetch = fetch): Promise<PortOccupantInfo> {
  for (const pathname of ["/ready", "/health", "/"]) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${listenPort}${pathname}`, {
        signal: AbortSignal.timeout(750)
      });
      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = contentType.includes("application/json") || contentType.startsWith("text/")
        ? await response.text()
        : "";
      if (contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(bodyText) as { service?: string };
          if (payload.service) {
            return {
              service: payload.service
            };
          }
        } catch {
          // Ignore malformed JSON and keep probing for another fingerprint.
        }
      }

      if (!response.ok) {
        continue;
      }

      const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/iu);
      const title = titleMatch?.[1]?.trim();
      return {
        description: title ? `HTTP listener (${title})` : `HTTP listener (${response.status})`
      };
    } catch {
      continue;
    }
  }

  return {};
}

type NavKey = "home" | "codex" | "sessions" | "projects" | "approvals" | "hosts" | "reports";

export function renderPage(
  title: string,
  body: string,
  options?: { basePath?: string; needsAuth?: boolean; authResetSession?: boolean; browserApiBaseUrl?: string; navKey?: NavKey }
): string {
  const basePath = normalizeBasePath(options?.basePath);
  const page = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        --bg: #f5f6f7;
        --bg-accent: linear-gradient(180deg, #fbfcfd 0%, #eef2f5 100%);
        --surface: rgba(255, 255, 255, 0.94);
        --surface-soft: #f0f5f3;
        --surface-strong: #ffffff;
        --ink: #17211d;
        --muted: #64716d;
        --accent: #0a7c66;
        --accent-strong: #075845;
        --warn: #9a6700;
        --danger: #b42318;
        --info: #2366a0;
        --border: rgba(23, 33, 29, 0.12);
        --shadow: 0 12px 26px rgba(21, 31, 27, 0.08);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 14px 14px 124px;
        background: var(--bg);
        background-image: var(--bg-accent);
        color: var(--ink);
        font-family: "Segoe UI Variable Text", "Trebuchet MS", "Helvetica Neue", sans-serif;
      }
      main {
        max-width: 1080px;
        margin: 0 auto;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px;
        margin-bottom: 12px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }
      .hero {
        background: var(--surface-strong);
        border-color: rgba(13, 127, 102, 0.16);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }
      h1, h2 {
        margin-top: 0;
        letter-spacing: 0;
      }
      h1 {
        font-size: 24px;
        line-height: 1.12;
        margin-bottom: 8px;
      }
      h2 {
        font-size: 18px;
        line-height: 1.25;
        margin-bottom: 12px;
      }
      code, pre {
        font-family: "SFMono-Regular", ui-monospace, monospace;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 48vh;
        overflow: auto;
      }
      a {
        color: var(--accent);
        text-decoration-thickness: 1px;
      }
      ul {
        padding-left: 20px;
      }
      .muted {
        color: var(--muted);
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }
      .topbar a {
        text-decoration: none;
        color: var(--accent-strong);
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid currentColor;
      }
      .badge-neutral {
        color: #6f675c;
        background: rgba(111, 103, 92, 0.08);
      }
      .badge-info {
        color: #2d5b7c;
        background: rgba(45, 91, 124, 0.1);
      }
      .badge-success {
        color: #0c7c59;
        background: rgba(12, 124, 89, 0.1);
      }
      .badge-warn {
        color: #8b5e10;
        background: rgba(139, 94, 16, 0.1);
      }
      .badge-danger {
        color: #a7382a;
        background: rgba(167, 56, 42, 0.1);
      }
      .status-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .status-list li {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px 0;
        border-top: 1px solid var(--border);
      }
      .status-list li:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .status-meta {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start;
      }
      .session-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .result-line {
        margin-top: 8px;
        color: var(--ink);
      }
      .meta-line {
        margin-top: 4px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }
      .meta-details {
        margin-top: 10px;
      }
      .meta-details summary {
        cursor: pointer;
        color: var(--accent-strong);
        font-weight: 650;
        min-height: 34px;
        display: inline-flex;
        align-items: center;
      }
      .meta-details dl {
        margin: 8px 0 0;
        display: grid;
        gap: 8px;
      }
      .meta-details dl div {
        display: grid;
        gap: 2px;
      }
      .meta-details dt {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
      }
      .meta-details dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .inline-form {
        display: grid;
        gap: 10px;
      }
      .form-row {
        display: grid;
        gap: 10px;
      }
      .intent-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .intent-grid label {
        display: block;
        position: relative;
      }
      .intent-grid label span {
        min-height: 48px;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.92);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-weight: 650;
      }
      .intent-grid input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .intent-grid input:checked + span {
        border-color: var(--accent);
        background: rgba(10, 124, 102, 0.1);
        color: var(--accent-strong);
      }
      .progress-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }
      .progress-step {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: #fff;
      }
      .progress-step-done {
        border-color: rgba(12, 124, 89, 0.35);
        background: rgba(12, 124, 89, 0.08);
      }
      .progress-step-current {
        border-color: rgba(45, 91, 124, 0.35);
        background: rgba(45, 91, 124, 0.08);
      }
      .progress-marker {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        border: 1px solid var(--border);
        background: #fff;
      }
      .kv-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .kv-item {
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.82);
      }
      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        letter-spacing: 0;
        text-transform: uppercase;
        color: var(--muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .button {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.95);
        color: var(--ink);
        text-decoration: none;
        font-weight: 650;
        transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
      }
      .button-primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #fff;
      }
      .button-danger {
        border-color: var(--danger);
        color: var(--danger);
      }
      .button:disabled {
        opacity: 0.64;
        cursor: wait;
        transform: none;
      }
      .button:not(:disabled):active {
        transform: translateY(1px);
      }
      .notice {
        border-radius: 8px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.92);
      }
      .notice-info {
        border-color: rgba(28, 93, 153, 0.2);
        background: rgba(28, 93, 153, 0.08);
      }
      .notice-success {
        border-color: rgba(12, 124, 89, 0.24);
        background: rgba(12, 124, 89, 0.08);
      }
      .notice-warn {
        border-color: rgba(154, 103, 0, 0.24);
        background: rgba(154, 103, 0, 0.08);
      }
      .notice-danger {
        border-color: rgba(180, 35, 24, 0.22);
        background: rgba(180, 35, 24, 0.08);
      }
      .auth-steps {
        display: grid;
        gap: 8px;
        margin-top: 14px;
      }
      .auth-step {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.84);
      }
      .auth-step::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #bcc8c4;
      }
      .auth-step[data-state="running"]::before {
        background: var(--info);
        box-shadow: 0 0 0 6px rgba(28, 93, 153, 0.12);
      }
      .auth-step[data-state="done"]::before {
        background: var(--accent);
      }
      .auth-step[data-state="error"]::before {
        background: var(--danger);
      }
      .bottom-nav {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 20;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0;
        border-top: 1px solid var(--border);
        background: rgba(250, 252, 250, 0.94);
        backdrop-filter: blur(12px);
      }
      .bottom-nav a {
        min-height: 62px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--muted);
        text-decoration: none;
        font-size: 12px;
        font-weight: 650;
        border-top: 2px solid transparent;
      }
      .bottom-nav a[aria-current="page"] {
        color: var(--accent-strong);
        border-top-color: var(--accent);
        background: rgba(13, 127, 102, 0.08);
      }
      .empty {
        border: 1px dashed var(--border);
        background: rgba(255, 255, 255, 0.82);
        border-radius: 8px;
        padding: 16px;
      }
      .draft-recovery {
        display: none;
        border-color: rgba(154, 103, 0, 0.35);
        background: #fff8e7;
      }
      .timeline {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .timeline li {
        border-left: 2px solid var(--border);
        padding: 0 0 12px 12px;
      }
      .timeline li p {
        margin-bottom: 6px;
      }
      textarea, input, select {
        width: 100%;
        min-height: 46px;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 12px;
        font: inherit;
        background: rgba(255, 255, 255, 0.95);
      }
      textarea {
        min-height: 108px;
        resize: vertical;
      }
      #task-draft {
        min-height: 150px;
      }
      @media (min-width: 760px) {
        body {
          padding: 24px 24px 96px;
        }
        h1 {
          font-size: 30px;
        }
        .form-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .status-list li {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
        }
        .status-meta {
          justify-content: flex-end;
        }
        .bottom-nav {
          grid-template-columns: repeat(6, 1fr);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="topbar">
        <a href="/"><strong>HappyTG</strong></a>
        <span class="badge badge-info">Mini App</span>
      </div>
      <section id="draft-recovery" class="panel draft-recovery">
        <h2>Есть незавершенный ввод</h2>
        <p class="muted">Можно продолжить с места остановки или начать заново. Это только локальный draft, backend state не меняется.</p>
        <div class="actions">
          <button class="button button-primary" type="button" data-draft-restore>Продолжить</button>
          <button class="button" type="button" data-draft-clear>Начать заново</button>
        </div>
      </section>
      ${body}
    </main>
    ${renderBottomNav(options?.navKey)}
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script>
      window.HAPPYTgApiBase = ${JSON.stringify(options?.browserApiBaseUrl ?? configuredBrowserApiBaseUrl)};
      window.HAPPYTgMiniAppBasePath = ${JSON.stringify(basePath)};
      window.HAPPYTgNeedsAuth = ${JSON.stringify(Boolean(options?.needsAuth))};
      window.HAPPYTgResetSession = ${JSON.stringify(Boolean(options?.authResetSession))};
      window.HAPPYTgSessionCookie = ${JSON.stringify(miniAppSessionCookieName)};
      (function () {
        var key = "happytg:miniapp:draft:v1";
        var sessionKey = "happytg:miniapp:session:v1";
        var ttlMs = 24 * 60 * 60 * 1000;
        var recovery = document.getElementById("draft-recovery");
        var authTitle = document.querySelector("[data-auth-title]");
        var authDetail = document.querySelector("[data-auth-detail]");
        var authStatus = document.querySelector("[data-auth-status]");
        var authRetry = document.querySelector("[data-auth-retry]");
        var authReload = document.querySelector("[data-auth-reload]");
        function apiUrl(pathname) {
          return new URL(pathname, window.HAPPYTgApiBase || window.location.origin);
        }
        function miniAppUrl(pathname) {
          return (window.HAPPYTgMiniAppBasePath || "") + pathname;
        }
        function setNotice(target, tone, message) {
          if (!target) return;
          target.className = "notice notice-" + tone;
          target.textContent = message;
        }
        function setActionFeedback(target, tone, message) {
          if (!target) return;
          target.hidden = false;
          setNotice(target, tone, message);
        }
        function setAuthStep(name, state) {
          var step = document.querySelector('[data-auth-step=\"' + name + '\"]');
          if (step) {
            step.setAttribute("data-state", state);
          }
        }
        function setAuthState(config) {
          if (authTitle && config.title) authTitle.textContent = config.title;
          if (authDetail && config.detail) authDetail.textContent = config.detail;
          if (authStatus && config.notice) setNotice(authStatus, config.tone || "info", config.notice);
          if (authRetry) authRetry.hidden = !config.retry;
          if (config.telegram) setAuthStep("telegram", config.telegram);
          if (config.session) setAuthStep("session", config.session);
          if (config.screen) setAuthStep("screen", config.screen);
        }
        function readError(response, fallback) {
          return response.text().then(function (bodyText) {
            if (!bodyText) return fallback;
            try {
              var payload = JSON.parse(bodyText);
              return payload.detail || payload.error || fallback;
            } catch (_error) {
              return bodyText;
            }
          }, function () {
            return fallback;
          });
        }
        function readDraft() {
          try {
            var parsed = JSON.parse(localStorage.getItem(key) || "null");
            if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > ttlMs) {
              localStorage.removeItem(key);
              return null;
            }
            return parsed;
          } catch (_error) {
            localStorage.removeItem(key);
            return null;
          }
        }
        function readSession() {
          try {
            var parsed = JSON.parse(localStorage.getItem(sessionKey) || "null");
            if (!parsed || !parsed.token || (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now())) {
              localStorage.removeItem(sessionKey);
              return null;
            }
            return parsed;
          } catch (_error) {
            localStorage.removeItem(sessionKey);
            return null;
          }
        }
        function persistSession(session) {
          localStorage.setItem(sessionKey, JSON.stringify(session));
          var maxAge = session.expiresAt ? Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)) : 3600;
          var cookiePath = window.HAPPYTgMiniAppBasePath || "/";
          var secure = location.protocol === "https:" ? "; secure" : "";
          document.cookie = window.HAPPYTgSessionCookie + "=" + encodeURIComponent(session.token) + "; path=" + cookiePath + "; max-age=" + maxAge + "; samesite=lax" + secure;
        }
        function clearSession() {
          localStorage.removeItem(sessionKey);
          var cookiePath = window.HAPPYTgMiniAppBasePath || "/";
          var secure = location.protocol === "https:" ? "; secure" : "";
          document.cookie = window.HAPPYTgSessionCookie + "=; path=" + cookiePath + "; max-age=0; samesite=lax" + secure;
        }
        function token() {
          return readSession()?.token;
        }
        var draft = readDraft();
        if (draft && recovery) {
          recovery.style.display = "block";
        }
        document.querySelectorAll("[data-draft]").forEach(function (input) {
          input.addEventListener("input", function () {
            localStorage.setItem(key, JSON.stringify({
              path: location.pathname + location.search,
              value: input.value,
              savedAt: Date.now()
            }));
          });
        });
        document.querySelector("[data-draft-restore]")?.addEventListener("click", function () {
          var current = readDraft();
          if (!current) return;
          var input = document.querySelector("[data-draft]");
          if (input && "value" in input) input.value = current.value || "";
        });
        document.querySelector("[data-draft-clear]")?.addEventListener("click", function () {
          localStorage.removeItem(key);
          if (recovery) recovery.style.display = "none";
        });
        authReload?.addEventListener("click", function () {
          location.reload();
        });
        var webApp = window.Telegram && window.Telegram.WebApp;
        if (window.HAPPYTgResetSession) {
          clearSession();
        }
        var savedSession = readSession();
        var authRequestStarted = false;
        var initDataWaitStartedAt = 0;
        var initDataWaitTimer = 0;
        var initDataWaitTimeoutMs = 5000;
        var initDataPollMs = 250;
        if (savedSession) {
          persistSession(savedSession);
          if (window.HAPPYTgNeedsAuth) {
            setAuthState({
              title: "Возвращаем рабочий экран",
              detail: "Локальная Mini App session найдена, обновляем страницу.",
              notice: "Сессия уже есть. Загружаем целевой экран.",
              tone: "success",
              telegram: "done",
              session: "done",
              screen: "running",
              retry: false
            });
            location.reload();
            return;
          }
        }
        function attemptMiniAppAuth() {
          var currentWebApp = window.Telegram && window.Telegram.WebApp;
          if (!currentWebApp || !currentWebApp.initData) {
            return false;
          }
          currentWebApp.ready();
          if (savedSession || authRequestStarted) {
            return true;
          }
          authRequestStarted = true;
          var params = new URLSearchParams(location.search);
          setAuthState({
            title: "Подключаем HappyTG",
            detail: "Проверяем Telegram и запрашиваем короткую Mini App session.",
            notice: "Подключение выполняется. Это занимает секунды.",
            tone: "info",
            telegram: "running",
            session: "running",
            screen: "pending",
            retry: false
          });
          fetch(apiUrl("/api/v1/miniapp/auth/session"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              initData: currentWebApp.initData,
              startAppPayload: params.get("tgWebAppStartParam") || params.get("startapp") || params.get("payload")
            })
          }).then(function (response) {
            if (!response.ok) {
              return readError(response, "Не удалось подтвердить Mini App session.").then(function (detail) {
                throw new Error(detail);
              });
            }
            return response.json();
          }).then(function (payload) {
            if (!payload || !payload.appSession) {
              throw new Error("Backend не выдал Mini App session.");
            }
            persistSession(payload.appSession);
            setAuthState({
              title: "Доступ подтвержден",
              detail: "Сессия создана, открываем рабочий экран.",
              notice: "Подключение завершено. Загружаем целевую страницу.",
              tone: "success",
              telegram: "done",
              session: "done",
              screen: "running",
              retry: false
            });
            if (window.HAPPYTgNeedsAuth) {
              location.reload();
            }
          }).catch(function (error) {
            setAuthState({
              title: "Mini App не подключилась",
              detail: "HappyTG не смог получить рабочую session через Telegram.",
              notice: error instanceof Error && error.message ? error.message : "Проверьте соединение и откройте Mini App снова из бота.",
              tone: "danger",
              telegram: "done",
              session: "error",
              screen: "pending",
              retry: true
            });
            authRequestStarted = false;
          });
          return true;
        }
        function waitForTelegramInitData() {
          initDataWaitTimer = 0;
          if (attemptMiniAppAuth()) {
            return;
          }
          if (!window.HAPPYTgNeedsAuth) {
            return;
          }
          if (!initDataWaitStartedAt) {
            initDataWaitStartedAt = Date.now();
          }
          if (Date.now() - initDataWaitStartedAt >= initDataWaitTimeoutMs) {
            setAuthState({
              title: "Ждем подтверждение из Telegram",
              detail: "Этот экран нужно открывать из Telegram Mini App, чтобы передать initData и выдать короткую session.",
              notice: "Не получили данные Telegram. Откройте Mini App из бота и попробуйте снова.",
              tone: "warn",
              telegram: "error",
              session: "pending",
              screen: "pending",
              retry: true
            });
            return;
          }
          setAuthState({
            title: "Открываем HappyTG",
            detail: "Mini App session проверяется через Telegram.",
            notice: "Ждем initData от Telegram. Если экран открыт вне Telegram, подключение не завершится.",
            tone: "info",
            telegram: "running",
            session: "pending",
            screen: "pending",
            retry: false
          });
          if (!initDataWaitTimer) {
            initDataWaitTimer = window.setTimeout(waitForTelegramInitData, initDataPollMs);
          }
        }
        authRetry?.addEventListener("click", function () {
          initDataWaitStartedAt = Date.now();
          if (!initDataWaitTimer) {
            waitForTelegramInitData();
          }
        });
        if (webApp && webApp.initData) {
          attemptMiniAppAuth();
        } else if (window.HAPPYTgNeedsAuth) {
          waitForTelegramInitData();
        }
        document.querySelectorAll("[data-approval-action]").forEach(function (button) {
          button.addEventListener("click", function () {
            var feedback = document.querySelector("[data-action-feedback]");
            var sessionToken = token();
            if (!sessionToken) {
              setActionFeedback(feedback, "danger", "Нет Mini App session. Откройте экран заново из бота.");
              return;
            }
            button.disabled = true;
            var previousLabel = button.textContent;
            button.textContent = "Отправляем...";
            setActionFeedback(feedback, "info", "Отправляем решение и обновляем состояние.");
            fetch(apiUrl("/api/v1/miniapp/approvals/" + encodeURIComponent(button.getAttribute("data-approval-id") || "") + "/resolve"), {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "authorization": "Bearer " + sessionToken
              },
              body: JSON.stringify({
                decision: button.getAttribute("data-decision"),
                scope: button.getAttribute("data-scope") || undefined,
                nonce: button.getAttribute("data-nonce") || undefined
              })
            }).then(function (response) {
              if (!response.ok) {
                return readError(response, "Не удалось выполнить действие по подтверждению.").then(function (detail) {
                  throw new Error(detail);
                });
              }
              return response.json();
            }).then(function () {
              setActionFeedback(feedback, "success", "Решение сохранено. Обновляем экран.");
              location.reload();
            }).catch(function (error) {
              button.disabled = false;
              button.textContent = previousLabel;
              setActionFeedback(feedback, "danger", error instanceof Error && error.message ? error.message : "Не удалось выполнить действие. Попробуйте снова.");
            });
          });
        });
        document.querySelectorAll("[data-desktop-action]").forEach(function (button) {
          button.addEventListener("click", function () {
            var feedback = document.querySelector("[data-action-feedback]");
            var sessionToken = token();
            if (!sessionToken) {
              setActionFeedback(feedback, "danger", "Нет Mini App session. Откройте экран заново из бота.");
              return;
            }
            var action = button.getAttribute("data-desktop-action") || "";
            var sessionId = button.getAttribute("data-session-id") || "";
            button.disabled = true;
            var previousLabel = button.textContent;
            button.textContent = "Отправляем...";
            setActionFeedback(feedback, "info", "Отправляем Codex Desktop действие через API.");
            fetch(miniAppUrl("/codex/desktop-action"), {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "authorization": "Bearer " + sessionToken
              },
              body: JSON.stringify({ sessionId: sessionId, action: action })
            }).then(function (response) {
              if (!response.ok) {
                return readError(response, "Desktop action unsupported.").then(function (detail) {
                  throw new Error(detail);
                });
              }
              return response.json();
            }).then(function () {
              setActionFeedback(feedback, "success", "Действие принято. Обновляем экран.");
              location.reload();
            }).catch(function (error) {
              button.disabled = false;
              button.textContent = previousLabel;
              setActionFeedback(feedback, "danger", error instanceof Error && error.message ? error.message : "Не удалось выполнить Desktop action.");
            });
          });
        });
        document.querySelector("[data-desktop-continue-form]")?.addEventListener("submit", function (event) {
          event.preventDefault();
          var form = event.currentTarget;
          var submit = form.querySelector("[type=submit]");
          var feedback = form.querySelector("[data-continue-feedback]");
          var sessionToken = token();
          if (!sessionToken) {
            setActionFeedback(feedback, "danger", "Нет Mini App session. Откройте экран заново из бота.");
            return;
          }
          var data = new FormData(form);
          var prompt = String(data.get("prompt") || "").trim();
          if (!prompt) {
            setActionFeedback(feedback, "danger", "prompt is required");
            return;
          }
          if (submit) submit.disabled = true;
          if (submit) submit.textContent = "Отправляем...";
          setActionFeedback(feedback, "info", "Отправляем prompt в Codex Desktop session.");
          fetch(miniAppUrl("/codex/desktop-continue"), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": "Bearer " + sessionToken
            },
            body: JSON.stringify({
              sessionId: data.get("sessionId"),
              prompt: prompt
            })
          }).then(function (response) {
            if (!response.ok) {
              return readError(response, "Не удалось продолжить Desktop session.").then(function (detail) {
                throw new Error(detail);
              });
            }
            return response.json();
          }).then(function () {
            setActionFeedback(feedback, "success", "Prompt отправлен. Обновляем history.");
            location.reload();
          }).catch(function (error) {
            if (submit) submit.disabled = false;
            if (submit) submit.textContent = "Отправить";
            setActionFeedback(feedback, "danger", error instanceof Error && error.message ? error.message : "Не удалось продолжить Desktop session.");
          });
        });
        document.querySelector("[data-new-task-form]")?.addEventListener("change", function (event) {
          if (event.target && event.target.name === "runtime") {
            var runtime = event.target.value || "codex-cli";
            document.querySelectorAll("[data-source-fields]").forEach(function (section) {
              section.hidden = section.getAttribute("data-source-fields") !== runtime;
            });
          }
          if (event.target && event.target.name === "intent") {
            var intent = event.target.value || "implement";
            var mode = document.querySelector("[name=mode]");
            var title = document.querySelector("[name=title]");
            var submit = document.querySelector("[data-new-task-form] [type=submit]");
            if (mode) mode.value = intent === "implement" ? "proof" : "quick";
            if (title && (!title.value || title.value === "Mini App task" || title.value === "Implementation question" || title.value === "Review implementation result")) {
              title.value = intent === "question" ? "Implementation question" : intent === "review" ? "Review implementation result" : "Mini App task";
            }
            if (submit) submit.textContent = intent === "question" ? "Отправить вопрос" : "Создать Codex-сессию";
          }
        });
        document.querySelector("[data-new-task-form]")?.addEventListener("submit", function (event) {
          event.preventDefault();
          var form = event.currentTarget;
          var submit = form.querySelector("[type=submit]");
          var feedback = form.querySelector("[data-task-feedback]");
          if (submit) submit.disabled = true;
          if (submit) submit.textContent = "Создаем...";
          setActionFeedback(feedback, "info", "Создаем сессию и готовим переход к деталям.");
          var data = new FormData(form);
          var runtime = String(data.get("runtime") || "codex-cli");
          var desktopProject = form.querySelector("[name=projectId]");
          var selectedDesktopProject = desktopProject && desktopProject.options ? desktopProject.options[desktopProject.selectedIndex] : null;
          fetch(location.pathname + location.search, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              hostId: data.get("hostId"),
              workspaceId: data.get("workspaceId"),
              runtime: runtime,
              projectId: runtime === "codex-desktop" ? data.get("projectId") : undefined,
              projectPath: runtime === "codex-desktop" && selectedDesktopProject ? selectedDesktopProject.getAttribute("data-project-path") : undefined,
              intent: data.get("intent") || "implement",
              contextSessionId: data.get("contextSessionId") || undefined,
              mode: data.get("mode") || "proof",
              title: data.get("title") || "Mini App task",
              prompt: data.get("prompt") || "",
              acceptanceCriteria: String(data.get("acceptanceCriteria") || "")
                .split(/\\r?\\n/)
                .map(function (item) { return item.trim(); })
                .filter(Boolean)
            })
          }).then(function (response) {
            if (!response.ok) {
              return readError(response, "Не удалось создать сессию.").then(function (detail) {
                throw new Error(detail);
              });
            }
            return response.json();
          }).then(function (payload) {
            localStorage.removeItem(key);
            var href = payload.sessionHref || (payload.session && payload.session.href) || "/sessions";
            if (window.HAPPYTgMiniAppBasePath && href.charAt(0) === "/") {
              href = window.HAPPYTgMiniAppBasePath + href;
            }
            setActionFeedback(feedback, "success", "Сессия создана. Открываем детальную страницу.");
            location.href = href;
          }).catch(function (error) {
            if (submit) submit.disabled = false;
            if (submit) submit.textContent = "Создать Codex-сессию";
            setActionFeedback(feedback, "danger", error instanceof Error && error.message ? error.message : "Не удалось создать сессию.");
          });
        });
      })();
    </script>
  </body>
</html>`;
  return prefixRootRelativeLinks(page, basePath);
}

function linkButton(label: string, href: string, primary = false): string {
  return `<a class="button${primary ? " button-primary" : ""}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function disabledButton(label: string, reason?: string): string {
  return `<button class="button" type="button" disabled title="${escapeHtml(reason ?? "unsupported")}">${escapeHtml(label)}</button>`;
}

function renderBottomNav(active?: NavKey): string {
  const items: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "home", href: "/", label: "Главная" },
    { key: "codex", href: "/codex", label: "Codex" },
    { key: "sessions", href: "/sessions", label: "Сессии" },
    { key: "projects", href: "/projects", label: "Проекты" },
    { key: "approvals", href: "/approvals", label: "Решения" },
    { key: "hosts", href: "/hosts", label: "Хосты" },
    { key: "reports", href: "/reports", label: "Отчеты" }
  ];
  return `<nav class="bottom-nav" aria-label="Основная навигация">${items.map((item) => `<a href="${item.href}"${item.key === active ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>`;
}

function renderEmptyState(title: string, detail: string, actionLabel: string, href: string): string {
  return `<div class="empty">
    <h2>${escapeHtml(title)}</h2>
    <p class="muted">${escapeHtml(detail)}</p>
    <div class="actions">${linkButton(actionLabel, href, true)}</div>
  </div>`;
}

function renderAuthPending(): string {
  return `<section class="panel hero">
    <p class="eyebrow">Подключение</p>
    <h1 data-auth-title>Открываем HappyTG</h1>
    <p class="muted" data-auth-detail>Mini App session проверяется через Telegram.</p>
    <div class="notice notice-info" data-auth-status>Ждем initData и короткую Mini App session.</div>
    <div class="auth-steps">
      <div class="auth-step" data-auth-step="telegram" data-state="pending"><strong>Telegram</strong><span class="muted">Получить initData</span></div>
      <div class="auth-step" data-auth-step="session" data-state="pending"><strong>Session</strong><span class="muted">Выдать короткий токен</span></div>
      <div class="auth-step" data-auth-step="screen" data-state="pending"><strong>Экран</strong><span class="muted">Открыть нужный раздел</span></div>
    </div>
    <div class="actions">
      <button class="button button-primary" type="button" data-auth-retry hidden>Повторить подключение</button>
      <button class="button" type="button" data-auth-reload>Обновить экран</button>
    </div>
  </section>`;
}

function approvalActionButton(label: string, approval: MiniAppApprovalCard, decision: "approved" | "rejected", scope?: string, primary = false): string {
  return `<button class="button${primary ? " button-primary" : decision === "rejected" ? " button-danger" : ""}" type="button" data-approval-action data-approval-id="${escapeHtml(approval.id)}" data-decision="${decision}" data-scope="${escapeHtml(scope ?? "")}" data-nonce="${escapeHtml(approval.nonce ?? "")}">${escapeHtml(label)}</button>`;
}

function nextActionLabel(action: string | undefined): string {
  switch (action) {
    case undefined:
    case "":
      return "Открыть";
    case "open approval":
    case "open_approval":
      return "Открыть approval";
    case "open verify":
    case "open_verify":
      return "Открыть verify";
    case "run_fix":
      return "Запустить fix";
    case "resume":
      return "Продолжить";
    case "open":
      return "Открыть";
    default:
      return /[А-Яа-яЁё]/u.test(action) ? action : "Открыть";
  }
}

function attentionLabel(attention: string | undefined): string | undefined {
  switch (attention) {
    case "approval":
      return "Нужно подтверждение";
    case "blocked":
      return "Сессия остановилась";
    case "verify":
      return "Verify требует внимания";
    case "unsupported":
      return "Действие недоступно";
    default:
      return attention;
  }
}

function renderDashboardView(dashboard: MiniAppDashboardProjection): string {
  const topAttention = dashboard.attention[0];
  const topAttentionBlock = topAttention
    ? `<div class="notice notice-${topAttention.severity === "danger" ? "danger" : topAttention.severity === "warn" ? "warn" : "info"}">
        <p class="eyebrow">Следующее действие</p>
        <strong>${escapeHtml(topAttention.title)}</strong>
        <div class="muted">${escapeHtml(topAttention.detail)}</div>
        <div class="actions">${linkButton(nextActionLabel(topAttention.nextAction), topAttention.href, true)}</div>
      </div>`
    : `<div class="notice notice-success">
        <p class="eyebrow">Следующее действие</p>
        <strong>Сейчас ничего не требует внимания</strong>
        <div class="muted">Можно запустить новую задачу или открыть последние сессии.</div>
      </div>`;
  const attention = dashboard.attention.length > 0
    ? `<ul class="status-list">${dashboard.attention.map((item) => `<li>
        <div><strong>${escapeHtml(item.title)}</strong><div class="muted">${escapeHtml(item.detail)}</div></div>
        <div class="status-meta">${renderBadge(item.severity)}${linkButton(nextActionLabel(item.nextAction), item.href)}</div>
      </li>`).join("")}</ul>`
    : renderEmptyState("Сейчас ничего не требует внимания", "Активные проблемы, approvals и verify failures появятся здесь.", "Открыть sessions", "/sessions");

  return `
    <section class="panel hero">
      <p class="eyebrow">Сейчас</p>
      <h1>Работа по проектам</h1>
      ${topAttentionBlock}
      <div class="actions">
        ${linkButton("Новая задача", "/new-task", true)}
        ${linkButton("Задать вопрос", newTaskHref({ intent: "question", title: "Implementation question" }))}
        ${linkButton("Codex", "/codex")}
        ${dashboard.recentSessions[0] ? linkButton("Продолжить последнюю", dashboard.recentSessions[0].href) : ""}
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>Результаты сессий</h2>
        ${linkButton("Все", "/sessions")}
      </div>
      ${renderSessionCards(dashboard.recentSessions)}
    </section>
    <details class="panel meta-details">
      <summary>Очередь и отчеты</summary>
      <section class="grid">
        <div class="kv-item"><div class="eyebrow">Активные</div><strong>${dashboard.stats.activeSessions}</strong></div>
        <div class="kv-item"><div class="eyebrow">Подтв.</div><strong>${dashboard.stats.pendingApprovals}</strong></div>
        <div class="kv-item"><div class="eyebrow">Блокеры</div><strong>${dashboard.stats.blockedSessions}</strong></div>
        <div class="kv-item"><div class="eyebrow">Verify</div><strong>${dashboard.stats.verifyProblems}</strong></div>
      </section>
      <h2>Требует внимания</h2>
      ${attention}
      <h2>Последние отчеты</h2>
      ${renderReportCards(dashboard.recentReports)}
    </details>
  `;
}

function runtimeLabel(runtime: string | undefined): string {
  if (runtime === "codex-cli") {
    return "Codex CLI";
  }
  if (runtime === "codex-desktop") {
    return "Codex Desktop";
  }
  return runtime ?? "runtime n/a";
}

function projectTasksHref(source: "codex-cli" | "codex-desktop", project: string, options: { path?: string; userId?: string } = {}): string {
  return codexPanelHref({ path: options.path ?? "/projects/tasks", source, project, userId: options.userId });
}

function codexPanelHref(input: {
  path?: string;
  source?: string;
  state?: string;
  project?: string;
  q?: string;
  sort?: string;
  limit?: number;
  userId?: string;
}): string {
  const params = new URLSearchParams();
  if (input.source && input.source !== "all") {
    params.set("source", input.source);
  }
  if (input.state && input.state !== "all") {
    params.set("state", input.state);
  }
  if (input.project && input.project !== "all") {
    params.set("project", input.project);
  }
  if (input.q?.trim()) {
    params.set("q", input.q.trim());
  }
  if (input.sort && input.sort !== "updated-desc") {
    params.set("sort", input.sort);
  }
  if (input.limit && input.limit > 0) {
    params.set("limit", String(input.limit));
  }
  if (input.userId) {
    params.set("userId", input.userId);
  }
  const query = params.toString();
  const path = input.path ?? "/codex";
  return query ? `${path}?${query}` : path;
}

type CodexPanelSort = "updated-desc" | "updated-asc" | "title-asc" | "title-desc";
type DesktopHistoryOrder = "oldest-first" | "newest-first";

function normalizeCodexPanelSort(value: string | undefined): CodexPanelSort {
  switch (value) {
    case "updated-asc":
    case "title-asc":
    case "title-desc":
      return value;
    default:
      return "updated-desc";
  }
}

function compareSessionCards(left: MiniAppSessionCard, right: MiniAppSessionCard, sort: CodexPanelSort): number {
  switch (sort) {
    case "updated-asc":
      return left.lastUpdatedAt.localeCompare(right.lastUpdatedAt);
    case "title-asc":
      return left.title.localeCompare(right.title);
    case "title-desc":
      return right.title.localeCompare(left.title);
    case "updated-desc":
    default:
      return right.lastUpdatedAt.localeCompare(left.lastUpdatedAt);
  }
}

function normalizeDesktopHistoryOrder(value: string | undefined): DesktopHistoryOrder {
  return value === "newest-first" ? "newest-first" : "oldest-first";
}

function desktopSessionHistoryHref(sessionId: string, historyOrder: DesktopHistoryOrder, userId?: string): string {
  const params = new URLSearchParams({
    id: sessionId,
    historyOrder
  });
  if (userId) {
    params.set("userId", userId);
  }
  return `/codex/desktop-session?${params.toString()}`;
}

function renderSessionCards(sessions: MiniAppSessionCard[]): string {
  if (sessions.length === 0) {
    return renderEmptyState("Нет активных сессий", "Когда host будет подключен, новая задача появится здесь.", "Проверить hosts", "/hosts");
  }

  return `<ul class="status-list">${sessions.map((session) => `<li>
    <div>
      <div class="session-title-row">
        ${renderBadge(sessionResultLabel(session), sessionResultTone(session))}
        <strong><a href="${escapeHtml(session.href)}">${escapeHtml(session.title)}</a></strong>
      </div>
      <div class="meta-line">${escapeHtml(runtimeLabel(session.runtime))} · ${escapeHtml(session.repoName ?? compactPath(session.projectPath))} · ${escapeHtml(compactDate(session.lastUpdatedAt))}</div>
      ${session.attention ? `<div class="result-line">${escapeHtml(attentionLabel(session.attention) ?? session.attention)}</div>` : ""}
      ${renderDetails("Технические детали", [
        { label: "session", value: session.id },
        { label: "state", value: session.desktopStatus ?? session.state },
        { label: "phase", value: session.phase },
        { label: "verify", value: session.verificationState },
        { label: "host", value: session.hostLabel },
        { label: "path", value: session.projectPath },
        { label: "updated", value: session.lastUpdatedAt },
        { label: "unsupported", value: session.unsupportedReasonCode ?? session.unsupportedReason }
      ])}
    </div>
    <div class="status-meta">${linkButton(nextActionLabel(session.nextAction), session.href, Boolean(session.attention))}</div>
  </li>`).join("")}</ul>`;
}

function desktopSessionCard(session: CodexDesktopSession): MiniAppSessionCard {
  return {
    id: session.id,
    title: session.title,
    state: session.status === "active" ? "running" : session.status === "archived" ? "completed" : session.status === "unknown" ? "blocked" : "paused",
    runtime: "codex-desktop",
    source: "codex-desktop",
    desktopStatus: session.status,
    repoName: session.projectPath ? session.projectPath.split(/[\\/]/u).filter(Boolean).at(-1) : "Desktop project",
    projectPath: session.projectPath,
    lastUpdatedAt: session.updatedAt,
    href: `/codex/desktop-session?id=${encodeURIComponent(session.id)}`,
    nextAction: "open",
    canResume: session.canResume,
    canStop: session.canStop,
    canCreateTask: session.canCreateTask,
    unsupportedReason: session.unsupportedReason,
    unsupportedReasonCode: session.unsupportedReasonCode
  };
}

type NewTaskCreatedPayload = {
  task?: { id: string };
  session?: MiniAppSessionCard | CodexDesktopSession;
};

function newTaskSessionHref(created: NewTaskCreatedPayload, runtime: string | undefined): string {
  const session = created.session;
  if (session && "href" in session && typeof session.href === "string") {
    return session.href;
  }

  if (runtime === "codex-desktop") {
    const desktopSessionId = session?.source === "codex-desktop" ? session.id : created.task?.id;
    return desktopSessionId
      ? `/codex/desktop-session?id=${encodeURIComponent(desktopSessionId)}`
      : "/codex?source=codex-desktop";
  }

  return "/sessions";
}

function desktopUnsupportedReason(session: Pick<CodexDesktopSession, "unsupportedReason" | "unsupportedReasonCode">): string {
  const reason = session.unsupportedReason ?? "Stable Codex Desktop control contract is unavailable.";
  return session.unsupportedReasonCode ? `[${session.unsupportedReasonCode}] ${reason}` : reason;
}

function renderSourceSwitcher(activeSource: string, options: { path?: string; project?: string; state?: string; q?: string; sort?: string; limit?: number; userId?: string } = {}): string {
  const items = [
    { value: "all", label: "Все" },
    { value: "codex-desktop", label: "Codex Desktop" },
    { value: "codex-cli", label: "Codex CLI" }
  ];
  return `<div class="actions">${items.map((item) => linkButton(item.label, codexPanelHref({
    path: options.path,
    source: item.value,
    project: options.project,
    state: options.state,
    q: options.q,
    sort: options.sort,
    limit: options.limit,
    userId: options.userId
  }), item.value === activeSource)).join("")}</div>`;
}

function matchesCodexSearch(card: MiniAppSessionCard, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    card.title,
    card.repoName,
    card.hostLabel,
    card.projectPath,
    card.runtime,
    card.state
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesCodexProject(card: MiniAppSessionCard, project: string | undefined): boolean {
  if (!project || project === "all") {
    return true;
  }
  return card.repoName === project || card.projectPath === project;
}

function renderDesktopActions(session: CodexDesktopSession): string {
  const reason = desktopUnsupportedReason(session);
  return `<div class="actions">
    ${session.canResume ? `<button class="button button-primary" type="button" data-desktop-action="resume" data-session-id="${escapeHtml(session.id)}">Resume</button>` : disabledButton("Resume", reason)}
    ${session.canStop ? `<button class="button button-danger" type="button" data-desktop-action="stop" data-session-id="${escapeHtml(session.id)}">Stop</button>` : disabledButton("Stop", reason)}
    ${session.canCreateTask ? linkButton("Новая задача", newTaskHref({ source: "codex-desktop", projectId: session.projectId, intent: "implement", contextSessionId: session.id }), true) : disabledButton("Новая задача", reason)}
    ${session.canCreateTask ? linkButton("Вопрос по реализации", newTaskHref({ source: "codex-desktop", projectId: session.projectId, intent: "question", title: "Implementation question", contextSessionId: session.id })) : disabledButton("Вопрос по реализации", reason)}
  </div>`;
}

function renderDesktopContinueForm(session: CodexDesktopSession): string {
  const canContinue = Boolean(session.canContinue ?? session.canResume);
  const reason = desktopUnsupportedReason(session);
  return `<section class="panel">
    <h2>Продолжить сессию</h2>
    <form data-desktop-continue-form class="grid">
      <input type="hidden" name="sessionId" value="${escapeHtml(session.id)}">
      <label><span class="eyebrow">Prompt</span><textarea name="prompt" placeholder="Новый запрос для этой Desktop-сессии"${canContinue ? "" : " disabled"}></textarea></label>
      <div class="actions">
        <button class="button button-primary" type="submit"${canContinue ? "" : ` disabled title="${escapeHtml(reason)}"`}>Отправить</button>
      </div>
      <div class="notice notice-info" data-continue-feedback hidden>Ждем prompt.</div>
    </form>
  </section>`;
}

function renderDesktopHistoryItem(entry: CodexDesktopHistoryEntry): string {
  const role = entry.role ? ` · ${entry.role}` : "";
  return `<li>
    <strong>${entry.sequence}. ${escapeHtml(entry.summary || entry.title || entry.kind)}</strong>
    <div class="meta-line">${escapeHtml(compactDate(entry.occurredAt))}</div>
    ${renderDetails("Event details", [
      { label: "kind", value: entry.kind },
      { label: "role", value: role.trim().replace(/^·\s*/u, "") },
      { label: "source", value: entry.source },
      { label: "occurred", value: entry.occurredAt }
    ])}
  </li>`;
}

function renderDesktopHistory(detail: CodexDesktopSessionDetail, options: { historyOrder?: DesktopHistoryOrder; userId?: string } = {}): string {
  const historyOrder = normalizeDesktopHistoryOrder(options.historyOrder);
  const historyControls = `<div class="actions">
    ${linkButton("Сначала старые", desktopSessionHistoryHref(detail.session.id, "oldest-first", options.userId), historyOrder === "oldest-first")}
    ${linkButton("Сначала новые", desktopSessionHistoryHref(detail.session.id, "newest-first", options.userId), historyOrder === "newest-first")}
  </div>`;
  if (detail.history.length === 0) {
    const unavailable = Boolean(detail.historyUnsupportedReasonCode);
    return `${historyControls}${renderEmptyState(
      unavailable ? "History недоступна" : "История пока пуста",
      unavailable
        ? detail.historyUnsupportedReason ?? "No bounded Codex Desktop history records were found for this session."
        : "Codex Desktop еще не вернул bounded history records для этой сессии.",
      unavailable ? "Codex Desktop" : "Обновить",
      unavailable ? "/codex?source=codex-desktop" : `/codex/desktop-session?id=${encodeURIComponent(detail.session.id)}`
    )}`;
  }

  const history = [...detail.history]
    .sort((left, right) => historyOrder === "newest-first"
      ? right.sequence - left.sequence
      : left.sequence - right.sequence);

  return `${historyControls}<ol class="timeline">${history.map(renderDesktopHistoryItem).join("")}</ol>
    ${detail.historyTruncated ? `<p class="muted">History truncated to a bounded read-only preview.</p>` : ""}`;
}

function renderCodexPanel(input: {
  cliSessions: MiniAppSessionCard[];
  desktopProjects: CodexDesktopProject[];
  desktopSessions: CodexDesktopSession[];
  load?: {
    cliSessions?: {
      ok: boolean;
      error?: string;
    };
    desktopProjects?: {
      ok: boolean;
      error?: string;
    };
    desktopSessions?: {
      ok: boolean;
      error?: string;
    };
  };
  source?: string;
  state?: string;
  project?: string;
  q?: string;
  sort?: string;
  desktopSessionLimit?: number;
  routePath?: string;
  resetHref?: string;
  userId?: string;
}): string {
  const source = input.source ?? "all";
  const query = input.q?.trim() ?? "";
  const sort = normalizeCodexPanelSort(input.sort);
  const desktopSessionLimit = input.desktopSessionLimit ?? 50;
  const hasProjectFilter = Boolean(input.project && input.project !== "all");
  const routePath = input.routePath ?? "/codex";
  const resetHref = input.resetHref ?? routePath;
  const desktopCards = input.desktopSessions.map(desktopSessionCard);
  const cliCards = input.cliSessions.map((session) => ({
    ...session,
    runtime: "codex-cli" as const,
    source: "codex-cli" as const
  }));
  const cards = [...desktopCards, ...cliCards]
    .filter((card) => source === "all" || card.source === source || card.runtime === source)
    .filter((card) => !input.state || input.state === "all" || card.state === input.state || card.desktopStatus === input.state || card.attention === input.state || (input.state === "unsupported" && Boolean(card.unsupportedReason)))
    .filter((card) => matchesCodexProject(card, input.project))
  .filter((card) => matchesCodexSearch(card, query))
  .sort((left, right) => compareSessionCards(left, right, sort));
  const visibleCards = hasProjectFilter ? cards.slice(0, 5) : cards;
  const loadWarnings: string[] = [];
  if (input.load?.cliSessions && !input.load.cliSessions.ok) {
    loadWarnings.push(`MiniApp sessions unavailable${input.load.cliSessions.error ? `: ${input.load.cliSessions.error}` : ""}.`);
  }
  if (input.load?.desktopProjects && !input.load.desktopProjects.ok) {
    loadWarnings.push(`Desktop projects unavailable${input.load.desktopProjects.error ? `: ${input.load.desktopProjects.error}` : ""}.`);
  }
  if (input.load?.desktopSessions && !input.load.desktopSessions.ok) {
    loadWarnings.push(`Desktop sessions unavailable${input.load.desktopSessions.error ? `: ${input.load.desktopSessions.error}` : ""}.`);
  }
  const canLoadMoreDesktop = !hasProjectFilter && input.desktopSessions.length >= desktopSessionLimit && desktopSessionLimit < 200;
  const moreDesktopHref = codexPanelHref({
    path: routePath,
    source,
    state: input.state,
    project: input.project,
    q: query,
    sort,
    limit: Math.min(200, Math.max(desktopSessionLimit * 2, 100)),
    userId: input.userId
  });

  return `
    <section class="panel hero">
      <p class="eyebrow">Сессии</p>
      <h1>Codex Desktop / CLI</h1>
      <div class="actions">
        ${linkButton("Новая задача", "/new-task", true)}
        ${linkButton("Задать вопрос", newTaskHref({ intent: "question", title: "Implementation question" }))}
      </div>
    </section>
      <section class="panel">
        <form method="GET" action="${escapeHtml(routePath)}" class="inline-form">
          <input type="hidden" name="source" value="${escapeHtml(source)}">
          ${input.project ? `<input type="hidden" name="project" value="${escapeHtml(input.project)}">` : ""}
          ${desktopSessionLimit !== 50 ? `<input type="hidden" name="limit" value="${escapeHtml(String(desktopSessionLimit))}">` : ""}
          ${input.userId ? `<input type="hidden" name="userId" value="${escapeHtml(input.userId)}">` : ""}
          <label><span class="eyebrow">Поиск</span><input name="q" value="${escapeHtml(query)}" placeholder="session, project, path"></label>
          <div class="actions"><button class="button button-primary" type="submit">Найти</button>${linkButton("Сбросить", resetHref)}</div>
          ${renderSourceSwitcher(source, { path: routePath, project: input.project, state: input.state, q: query, sort, limit: desktopSessionLimit !== 50 ? desktopSessionLimit : undefined, userId: input.userId })}
          <details class="meta-details">
            <summary>Фильтры</summary>
            <div class="form-row">
              <label><span class="eyebrow">State</span><select name="state">
                ${["all", "active", "recent", "archived", "unknown", "running", "paused", "completed", "blocked", "unsupported"].map((state) => `<option value="${state}"${input.state === state ? " selected" : ""}>${state}</option>`).join("")}
              </select></label>
              <label><span class="eyebrow">Sort</span><select name="sort">
                ${[
                  ["updated-desc", "Updated newest"],
                  ["updated-asc", "Updated oldest"],
                  ["title-asc", "Title A-Z"],
                  ["title-desc", "Title Z-A"]
                ].map(([value, label]) => `<option value="${value}"${sort === value ? " selected" : ""}>${label}</option>`).join("")}
              </select></label>
            </div>
          </details>
        </form>
    </section>
    ${loadWarnings.length > 0 ? `<section class="notice notice-warn">${loadWarnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</section>` : ""}
    <section class="panel">
      <div class="panel-header">
        <h2>Результаты</h2>
        ${renderBadge(`${visibleCards.length} visible`, "info")}
      </div>
      ${renderSessionCards(visibleCards)}
      ${canLoadMoreDesktop ? `<div class="actions">${linkButton(`Показать до ${Math.min(200, Math.max(desktopSessionLimit * 2, 100))} Desktop sessions`, moreDesktopHref)}</div>` : ""}
    </section>
    <details class="panel meta-details">
      <summary>Проекты и счетчики</summary>
      <section class="grid">
        <div class="kv-item"><div class="eyebrow">Desktop projects</div><strong>${input.desktopProjects.length}</strong></div>
        <div class="kv-item"><div class="eyebrow">Desktop sessions</div><strong>${input.desktopSessions.length}</strong></div>
        <div class="kv-item"><div class="eyebrow">CLI sessions</div><strong>${input.cliSessions.length}</strong></div>
      </section>
      <h2>Codex Desktop projects</h2>
      ${input.desktopProjects.length === 0 ? renderEmptyState("Desktop projects не найдены", "Adapter returned no local Codex Desktop projects.", "Обновить", "/codex?source=codex-desktop") : `<ul class="status-list">${input.desktopProjects.map((project) => `<li><div><strong>${escapeHtml(project.label)}</strong><div class="meta-line">${escapeHtml(compactPath(project.path))}</div>${renderDetails("Project details", [{ label: "path", value: project.path }])}</div><div class="status-meta">${renderBadge(project.active ? "active" : "saved")}${linkButton("Прошедшие задачи", projectTasksHref("codex-desktop", project.path, { path: routePath, userId: input.userId }))}${linkButton("Новая задача", newTaskHref({ source: "codex-desktop", projectId: project.id, intent: "implement" }), project.active)}${linkButton("Вопрос", newTaskHref({ source: "codex-desktop", projectId: project.id, intent: "question", title: "Implementation question" }))}</div></li>`).join("")}</ul>`}
    </details>
  `;
}

function renderDesktopSessionDetail(detail: CodexDesktopSessionDetail, options: { historyOrder?: string; userId?: string } = {}): string {
  const session = detail.session;
  const historyOrder = normalizeDesktopHistoryOrder(options.historyOrder);
  const latest = detail.history.at(-1);
  const sessionCard = desktopSessionCard(session);
  return `
    <section class="panel hero">
      <p class="eyebrow">Codex Desktop</p>
      <h1>${escapeHtml(session.title)}</h1>
      <div class="session-title-row">${renderBadge(sessionResultLabel(sessionCard), sessionResultTone(sessionCard))}<span class="muted">${escapeHtml(compactPath(session.projectPath))} · ${escapeHtml(compactDate(session.updatedAt))}</span></div>
      <p class="result-line">${escapeHtml(latest?.summary ?? "Результат появится после первого ответа Codex Desktop.")}</p>
      <div class="notice notice-info" data-action-feedback hidden>Ждем действие.</div>
      ${renderDesktopActions(session)}
      ${renderDetails("Технические детали", [
        { label: "session", value: session.id },
        { label: "status", value: session.status },
        { label: "updated", value: session.updatedAt },
        { label: "path", value: session.projectPath },
        { label: "contract", value: session.canResume || session.canStop || session.canCreateTask ? "partial" : "unsupported" }
      ])}
    </section>
    ${renderDesktopContinueForm(session)}
    <section class="panel">
      <h2>Результат и ход работы</h2>
      ${renderDesktopHistory(detail, { historyOrder, userId: options.userId })}
    </section>
  `;
}

function renderProjectCards(projects: MiniAppProjectCard[], options: { userId?: string } = {}): string {
  if (projects.length === 0) {
    return renderEmptyState("CLI проекты не найдены", "Подключите host daemon и дождитесь hello со списком workspaces.", "Проверить хосты", "/hosts");
  }

  return `<ul class="status-list">${projects.map((project) => `<li>
    <div>
      <strong><a href="${escapeHtml(project.href)}">${escapeHtml(project.repoName)}</a></strong>
      <div class="meta-line">${escapeHtml(project.hostLabel ?? "host n/a")} · active ${project.activeSessions}</div>
      ${renderDetails("Project details", [
        { label: "path", value: project.path },
        { label: "branch", value: project.defaultBranch },
        { label: "host", value: project.hostLabel }
      ])}
    </div>
    <div class="status-meta">${project.hostStatus ? renderBadge(project.hostStatus) : ""}${linkButton("Прошедшие задачи", projectTasksHref("codex-cli", project.path, { userId: options.userId }))}${linkButton("Новая задача", project.newSessionHref, true)}${linkButton("Вопрос", newTaskHref({ workspaceId: project.id, intent: "question", title: "Implementation question" }))}</div>
  </li>`).join("")}</ul>`;
}

function renderDesktopProjectCards(projects: CodexDesktopProject[], options: { userId?: string } = {}): string {
  if (projects.length === 0) {
    return renderEmptyState("Desktop projects не найдены", "Codex Desktop adapter did not return local projects.", "Codex Desktop", "/codex?source=codex-desktop");
  }

  return `<ul class="status-list">${projects.map((project) => `<li>
    <div>
      <strong>${escapeHtml(project.label)}</strong>
      <div class="meta-line">${escapeHtml(compactPath(project.path))}</div>
      ${renderDetails("Project details", [{ label: "path", value: project.path }])}
    </div>
    <div class="status-meta">${renderBadge("Codex Desktop", "info")}${renderBadge(project.active ? "active" : "saved")}${linkButton("Прошедшие задачи", projectTasksHref("codex-desktop", project.path, { userId: options.userId }))}${linkButton("Новая задача", newTaskHref({ source: "codex-desktop", projectId: project.id, intent: "implement" }), project.active)}${linkButton("Вопрос", newTaskHref({ source: "codex-desktop", projectId: project.id, intent: "question", title: "Implementation question" }))}</div>
  </li>`).join("")}</ul>`;
}

function renderProjectsView(
  projects: MiniAppProjectCard[],
  desktopProjects: CodexDesktopProject[],
  options: {
    desktopProjectsLoad?: {
      ok: boolean;
      error?: string;
    };
    userId?: string;
  } = {}
): string {
  const totalProjects = projects.length + desktopProjects.length;
  const desktopProjectsUnavailable = options?.desktopProjectsLoad && !options.desktopProjectsLoad.ok;
  const empty = totalProjects === 0
    ? `<section class="panel">${renderEmptyState("Проекты не найдены", "Подключите host daemon или Codex Desktop adapter, чтобы HappyTG получил список projects.", "Проверить хосты", "/hosts")}</section>`
    : "";

  return `<section class="panel hero"><h1>Проекты</h1><div class="actions">${linkButton("Новая задача", "/new-task", true)}${linkButton("Вопрос", newTaskHref({ intent: "question", title: "Implementation question" }))}</div></section>
    ${desktopProjectsUnavailable ? `<section class="notice notice-warn">${escapeHtml(`Desktop projects unavailable${options?.desktopProjectsLoad?.error ? `: ${options.desktopProjectsLoad.error}` : ""}.`)}</section>` : ""}
    <section class="grid">
      <div class="kv-item"><div class="eyebrow">CLI projects</div><strong>${projects.length}</strong></div>
      <div class="kv-item"><div class="eyebrow">Desktop projects</div><strong>${desktopProjects.length}</strong></div>
      <div class="kv-item"><div class="eyebrow">Active Desktop</div><strong>${desktopProjects.filter((project) => project.active).length}</strong></div>
    </section>
    ${empty}
    <section class="panel">
      <h2>Codex CLI projects</h2>
      ${renderProjectCards(projects, { userId: options.userId })}
    </section>
    <section class="panel">
      <h2>Codex Desktop projects</h2>
      ${renderDesktopProjectCards(desktopProjects, { userId: options.userId })}
    </section>`;
}

function renderNewTaskForm(
  projects: MiniAppProjectCard[],
  selected?: {
    hostId?: string;
    workspaceId?: string;
    source?: string;
    projectId?: string;
    intent?: string;
    title?: string;
    contextSessionId?: string;
  },
  desktop?: { projects: CodexDesktopProject[]; control?: CodexDesktopControlStatus }
): string {
  const selectedWorkspaceId = selected?.workspaceId ?? projects[0]?.id;
  const selectedProject = projects.find((project) => project.id === selectedWorkspaceId) ?? projects[0];
  const desktopProjects = desktop?.projects ?? [];
  const desktopCanCreate = Boolean(desktop?.control?.canCreateTask);
  const selectedSource = selected?.source === "codex-desktop" || (projects.length === 0 && desktopCanCreate) ? "codex-desktop" : "codex-cli";
  const selectedIntent = normalizeNewTaskIntent(selected?.intent);
  const selectedMode = defaultModeForIntent(selectedIntent);
  const title = selected?.title ?? (selectedIntent === "question" ? "Implementation question" : selectedIntent === "review" ? "Review implementation result" : "Mini App task");
  const desktopReason = desktop?.control?.unsupportedReason || desktop?.control?.unsupportedReasonCode
    ? desktopUnsupportedReason(desktop.control)
    : "Stable Codex Desktop New Task contract is unavailable.";
  const options = projects.map((project) => `<option value="${escapeHtml(project.id)}" data-host-id="${escapeHtml(project.hostId)}"${project.id === selectedProject?.id ? " selected" : ""}>${escapeHtml(project.repoName)} · ${escapeHtml(project.hostLabel ?? "host n/a")}</option>`).join("");
  const selectedDesktopProjectId = selected?.projectId ?? desktopProjects[0]?.id;
  const desktopOptions = desktopProjects.map((project) => `<option value="${escapeHtml(project.id)}" data-project-path="${escapeHtml(project.path)}"${project.id === selectedDesktopProjectId ? " selected" : ""}>${escapeHtml(project.label)} · ${escapeHtml(project.path)}</option>`).join("");
  const hasAnyProjects = projects.length > 0 || desktopProjects.length > 0;

  return `<section class="panel hero">
    <h1>${escapeHtml(intentLabel(selectedIntent))}</h1>
    <div class="actions">${linkButton("Сессии", "/sessions")}${linkButton("Проекты", "/projects")}</div>
  </section>
  <section class="panel">
    ${!hasAnyProjects ? renderEmptyState("Нет доступных проектов", "Сначала подключите host daemon или Codex Desktop adapter, чтобы HappyTG получил список workspaces.", "Проверить hosts", "/hosts") : `<form data-new-task-form class="inline-form">
      <div class="intent-grid" role="radiogroup" aria-label="Intent">
        ${(["implement", "question", "review"] as const).map((intent) => `<label><input type="radio" name="intent" value="${intent}"${selectedIntent === intent ? " checked" : ""}><span>${escapeHtml(intentLabel(intent))}</span></label>`).join("")}
      </div>
      <input type="hidden" name="hostId" value="${escapeHtml(selectedProject?.hostId ?? selected?.hostId ?? "")}">
      <input type="hidden" name="contextSessionId" value="${escapeHtml(selected?.contextSessionId ?? "")}">
      <div class="notice notice-info" data-task-feedback hidden>Создаем сессию.</div>
      ${desktopCanCreate ? "" : `<div class="notice notice-warn">New Desktop Task disabled: ${escapeHtml(desktopReason)}</div>`}
      <label class="eyebrow" for="task-draft">Инструкция</label>
      <textarea id="task-draft" name="prompt" data-draft placeholder="${selectedIntent === "question" ? "Что нужно уточнить по реализации?" : selectedIntent === "review" ? "Что проверить в результате сессии?" : "Что нужно реализовать или исправить?"}"></textarea>
      <details class="meta-details">
        <summary>Настройки</summary>
        <div class="form-row">
          <label><span class="eyebrow">Source</span><select id="runtime" name="runtime">
            <option value="codex-cli"${selectedSource === "codex-cli" ? " selected" : ""}${projects.length > 0 ? "" : " disabled"}>Codex CLI${projects.length > 0 ? "" : " (no host project)"}</option>
            <option value="codex-desktop"${selectedSource === "codex-desktop" ? " selected" : ""}${desktopCanCreate ? "" : " disabled"}>Codex Desktop${desktopCanCreate ? "" : " (unsupported)"}</option>
          </select></label>
          <label><span class="eyebrow">Mode</span><select id="mode" name="mode">
            <option value="proof"${selectedMode === "proof" ? " selected" : ""}>proof</option>
            <option value="quick"${selectedMode === "quick" ? " selected" : ""}>quick</option>
          </select></label>
        </div>
        <div data-source-fields="codex-cli"${selectedSource === "codex-cli" ? "" : " hidden"}>
          <label class="eyebrow" for="workspaceId">CLI проект</label>
          <select id="workspaceId" name="workspaceId" onchange="this.form.hostId.value = this.options[this.selectedIndex].getAttribute('data-host-id') || ''">${options}</select>
        </div>
        <div data-source-fields="codex-desktop"${selectedSource === "codex-desktop" ? "" : " hidden"}>
          <label class="eyebrow" for="projectId">Desktop проект</label>
          <select id="projectId" name="projectId">${desktopOptions}</select>
        </div>
        <label class="eyebrow" for="title">Название</label>
        <input id="title" name="title" value="${escapeHtml(title)}">
        <label class="eyebrow" for="acceptanceCriteria">Критерии приемки</label>
        <textarea id="acceptanceCriteria" name="acceptanceCriteria" placeholder="Каждый критерий с новой строки"></textarea>
      </details>
      <div class="actions"><button class="button button-primary" type="submit">${selectedIntent === "question" ? "Отправить вопрос" : "Создать Codex-сессию"}</button>${linkButton("Отмена", "/projects")}</div>
    </form>`}
  </section>`;
}

function renderApprovalCards(approvals: MiniAppApprovalCard[]): string {
  if (approvals.length === 0) {
    return renderEmptyState("Нет pending approvals", "Если агенту понадобится рискованное действие, запрос появится отдельной карточкой.", "Открыть сессии", "/sessions");
  }

  return `<ul class="status-list">${approvals.map((approval) => `<li>
    <div>
      <strong><a href="${escapeHtml(approval.href)}">${escapeHtml(approval.title)}</a></strong>
      <div class="muted">${escapeHtml(approval.reason)} · expires ${escapeHtml(approval.expiresAt)}</div>
    </div>
    <div class="status-meta">${renderBadge(approval.risk)}${renderBadge(approval.state)}${linkButton("Открыть", approval.href, approval.state === "waiting_human")}</div>
  </li>`).join("")}</ul>`;
}

function renderHostCards(hosts: MiniAppHostCard[]): string {
  if (hosts.length === 0) {
    return renderEmptyState("Host еще не подключен", "Подключите host daemon через pairing, чтобы HappyTG мог работать рядом с repo.", "Открыть хосты", "/hosts");
  }

  return `<ul class="status-list">${hosts.map((host) => `<li>
    <div>
      <strong><a href="${escapeHtml(host.href)}">${escapeHtml(host.label)}</a></strong>
      <div class="muted">${escapeHtml(host.repoNames.join(", ") || "repos not reported")} · active ${host.activeSessions}</div>
      ${host.lastError ? `<div class="muted">${escapeHtml(host.lastError)}</div>` : ""}
    </div>
    <div class="status-meta">${renderBadge(host.status)}${linkButton("Открыть", host.href)}</div>
  </li>`).join("")}</ul>`;
}

function renderReportCards(reports: MiniAppReportCard[]): string {
  if (reports.length === 0) {
    return renderEmptyState("Отчетов пока нет", "Proof-loop отчеты появятся после первой задачи с evidence и verify.", "Открыть сессии", "/sessions");
  }

  return `<ul class="status-list">${reports.map((report) => `<li>
    <div><strong><a href="${escapeHtml(report.href)}">${escapeHtml(report.title)}</a></strong><div class="muted">${escapeHtml(report.generatedAt)}</div></div>
    <div class="status-meta">${renderBadge(report.status)}${linkButton("Отчет", report.href)}</div>
  </li>`).join("")}</ul>`;
}

function renderDiffView(diff: MiniAppDiffProjection): string {
  const filters = ["все", "код", "конфиг", "тесты", "docs"].map((label) => `<span class="badge badge-info">${label}</span>`).join("");
  return `
    <section class="panel hero">
      <p class="eyebrow">Diff summary</p>
      <h1>Изменения по сессии</h1>
      <p class="muted">Сначала summary и риск-файлы, raw details открываются ниже.</p>
      <div class="grid">
        <div class="kv-item"><div class="eyebrow">Files</div><strong>${diff.summary.changedFiles}</strong></div>
        <div class="kv-item"><div class="eyebrow">High risk</div><strong>${diff.summary.highRiskFiles.length}</strong></div>
      </div>
    </section>
    <section class="panel">
      <h2>Фильтры</h2>
      <div class="actions">${filters}</div>
    </section>
    <section class="panel">
      <h2>Файлы</h2>
      ${diff.files.length === 0 ? renderEmptyState("Diff пока недоступен", "Host еще не отправил diff artifacts для этой сессии.", "Открыть session", `/session/${encodeURIComponent(diff.sessionId)}`) : `<ul class="status-list">${diff.files.map((file) => `<li><div><strong>${escapeHtml(file.path)}</strong><div class="muted">${escapeHtml(file.summary)}</div></div><div class="status-meta">${renderBadge(file.category)}${renderBadge(file.status)}</div></li>`).join("")}</ul>`}
    </section>
  `;
}

function renderVerifyView(verify: MiniAppVerifyProjection): string {
  const headline = verify.state === "passed" ? "PASS" : verify.state === "failed" ? "FAIL" : verify.state.toUpperCase();
  return `
    <section class="panel hero">
      <p class="eyebrow">Fresh verify</p>
      <h1>${escapeHtml(headline)}</h1>
      <p class="muted">Decision-first summary: что проверено, что упало и что делать дальше.</p>
      <div class="actions">
        ${verify.nextAction === "run_fix" ? linkButton("Запустить fix", `/session/${encodeURIComponent(verify.sessionId)}`, true) : ""}
        ${linkButton("Открыть evidence", verify.evidenceHref ?? `/session/${encodeURIComponent(verify.sessionId)}`)}
        ${linkButton("Diff", `/diff/${encodeURIComponent(verify.sessionId)}`)}
      </div>
    </section>
    <section class="panel">
      <h2>Acceptance criteria</h2>
      <div class="grid">
        <div class="kv-item"><div class="eyebrow">Checked</div><strong>${verify.checkedCriteria.length}</strong></div>
        <div class="kv-item"><div class="eyebrow">Failed</div><strong>${verify.failedCriteria.length}</strong></div>
      </div>
      <pre>${escapeHtml([...verify.checkedCriteria.map((item) => `OK ${item}`), ...verify.failedCriteria.map((item) => `FAIL ${item}`)].join("\n") || "Verifier details are not available yet.")}</pre>
    </section>
  `;
}

function renderSessionDetail(detail: {
  session: MiniAppSessionCard & { prompt: string; currentSummary?: string; lastError?: string };
  task?: TaskBundle;
  approval?: MiniAppApprovalCard;
  events: SessionEvent[];
  actions: string[];
}): string {
  const questionHref = newTaskHref({
    workspaceId: detail.task?.workspaceId,
    intent: "question",
    title: "Implementation question",
    contextSessionId: detail.session.id
  });
  const taskHref = newTaskHref({
    workspaceId: detail.task?.workspaceId,
    intent: "implement",
    contextSessionId: detail.session.id
  });
  return `
    <section class="panel hero">
      <p class="eyebrow">Session</p>
      <h1>${escapeHtml(detail.session.title)}</h1>
      <div class="session-title-row">${renderBadge(sessionResultLabel(detail.session), sessionResultTone(detail.session))}<span class="muted">${escapeHtml(runtimeLabel(detail.session.runtime))} · ${escapeHtml(detail.session.repoName ?? "repo n/a")} · ${escapeHtml(compactDate(detail.session.lastUpdatedAt))}</span></div>
      <div class="actions">
        ${detail.approval && detail.approval.state === "waiting_human" ? linkButton("Открыть approval", detail.approval.href, true) : ""}
        ${linkButton("Задать вопрос", questionHref, !detail.approval || detail.approval.state !== "waiting_human")}
        ${linkButton("Новая задача", taskHref)}
        ${detail.task ? linkButton("Proof timeline", `/task/${encodeURIComponent(detail.task.id)}`) : ""}
        ${linkButton("Diff", `/diff/${encodeURIComponent(detail.session.id)}`)}
        ${linkButton("Verify", `/verify/${encodeURIComponent(detail.session.id)}`)}
      </div>
      ${renderDetails("Технические детали", [
        { label: "session", value: detail.session.id },
        { label: "state", value: detail.session.state },
        { label: "phase", value: detail.session.phase },
        { label: "verify", value: detail.session.verificationState },
        { label: "host", value: detail.session.hostLabel },
        { label: "path", value: detail.session.projectPath }
      ])}
    </section>
    <section class="panel">
      <h2>Результат</h2>
      <p>${escapeHtml(detail.session.currentSummary ?? "Сводки пока нет.")}</p>
      ${detail.session.lastError ? `<p class="muted">${escapeHtml(detail.session.lastError)}</p>` : ""}
    </section>
    ${detail.task ? renderProofProgress(detail.task, { sessionState: detail.session.state }) : ""}
    <details class="panel meta-details">
      <summary>Timeline</summary>
      <ol class="timeline">${detail.events.map((event) => `<li><strong>${event.sequence}. ${escapeHtml(event.type)}</strong><div class="muted">${escapeHtml(event.occurredAt)}</div><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></li>`).join("") || "<li>No events recorded.</li>"}</ol>
    </details>
  `;
}

export async function startMiniAppServer(
  server = createMiniAppServer(),
  options?: {
    port?: number;
    logger?: Pick<Logger, "info">;
    fetchImpl?: typeof fetch;
    reuseProbeWindowMs?: number;
    reuseProbeIntervalMs?: number;
  }
): Promise<MiniAppStartupResult> {
  const listenPort = options?.port ?? port;
  const activeLogger = options?.logger ?? logger;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const reuseProbeWindowMs = options?.reuseProbeWindowMs ?? 2_000;
  const reuseProbeIntervalMs = options?.reuseProbeIntervalMs ?? Math.min(100, reuseProbeWindowMs);

  async function listenOnce(): Promise<"listening" | "in_use"> {
    return await new Promise<"listening" | "in_use">((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve("listening");
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EADDRINUSE") {
          resolve("in_use");
          return;
        }
        reject(error);
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(listenPort);
    });
  }

  if (await listenOnce() === "listening") {
    activeLogger.info("Mini App listening", { port: listenPort, apiBaseUrl });
    return { status: "listening", port: listenPort };
  }

  const occupant = await detectPortOccupant(listenPort, fetchImpl);
  if (occupant.service !== "miniapp") {
    throw new Error(formatMiniAppPortConflictMessageDetailed(listenPort, occupant));
  }

  if (reuseProbeWindowMs > 0) {
    for (let waitedMs = 0; waitedMs < reuseProbeWindowMs; waitedMs += reuseProbeIntervalMs) {
      await delay(reuseProbeIntervalMs);
      const occupantAfterDelay = await detectPortOccupant(listenPort, fetchImpl);
      if (!occupantAfterDelay.service && !occupantAfterDelay.description) {
        if (await listenOnce() === "listening") {
          activeLogger.info("Mini App listening", { port: listenPort, apiBaseUrl });
          return { status: "listening", port: listenPort };
        }

        const retryOccupant = await detectPortOccupant(listenPort, fetchImpl);
        if (retryOccupant.service !== "miniapp") {
          throw new Error(formatMiniAppPortConflictMessageDetailed(listenPort, retryOccupant));
        }
        continue;
      }

      if (occupantAfterDelay.service !== "miniapp") {
        throw new Error(formatMiniAppPortConflictMessageDetailed(listenPort, occupantAfterDelay));
      }
    }
  }

  activeLogger.info(formatMiniAppPortReuseMessage(listenPort), { port: listenPort });
  return { status: "reused", port: listenPort };
}

export function createMiniAppServer(dependencies: MiniAppDependencies = { fetchJson: defaultFetchJson }) {
  const withUser = (pathname: string, url: URL) => {
    const userId = url.searchParams.get("userId");
    return userId ? `${pathname}${pathname.includes("?") ? "&" : "?"}userId=${encodeURIComponent(userId)}` : pathname;
  };
  const basePathFor = (req: { headers: Record<string, string | string[] | undefined> }) => normalizeBasePath(req.headers["x-forwarded-prefix"] ?? process.env.HAPPYTG_MINIAPP_BASE_PATH);
  const expiredSessionCookieHeaders = (req: { headers: Record<string, string | string[] | undefined> }) => {
    const cookiePath = basePathFor(req) || "/";
    const expired = `${miniAppSessionCookieName}=; path=${cookiePath}; max-age=0; samesite=lax`;
    return [expired, `${expired}; secure`];
  };
  const hasSessionContext = (req: { headers: Record<string, string | string[] | undefined> }, url: URL) => Boolean(miniAppSessionToken(req.headers) || url.searchParams.get("userId"));
  const authInit = (req: { headers: Record<string, string | string[] | undefined> }): RequestInit | undefined => {
    const sessionToken = miniAppSessionToken(req.headers);
    return sessionToken
      ? {
          headers: {
            authorization: `Bearer ${sessionToken}`
          }
        }
      : undefined;
  };
  const fetchForRequest = <T>(req: { headers: Record<string, string | string[] | undefined> }, url: URL, pathname: string) => dependencies.fetchJson<T>(withUser(pathname, url), authInit(req));
  const defaultCodexFetchTimeoutMs = 6000;
  const codexFetchTimeoutMs = Number(process.env.HAPPYTG_MINIAPP_CODEX_FETCH_TIMEOUT_MS ?? String(defaultCodexFetchTimeoutMs));
  const effectiveCodexFetchTimeoutMs = () => Number.isFinite(codexFetchTimeoutMs) && codexFetchTimeoutMs > 0 ? codexFetchTimeoutMs : defaultCodexFetchTimeoutMs;
  const desktopSessionsFetchTimeoutMs = (limit: number) => {
    const baseTimeoutMs = effectiveCodexFetchTimeoutMs();
    return limit >= 100 ? Math.max(baseTimeoutMs, 10_000) : baseTimeoutMs;
  };
  const describeFetchError = (error: unknown, timeoutMs: number): string | undefined => {
    if (!(error instanceof Error)) {
      return "Unknown mini app fetch error.";
    }

    if (error.name === "AbortError" || /operation was aborted|aborted/iu.test(error.message)) {
      return `request timed out after ${timeoutMs}ms`;
    }

    return error.message || "Mini app fetch failed.";
  };
  const fetchForRequestWithFallback = async <T>(
    req: { headers: Record<string, string | string[] | undefined> },
    url: URL,
    pathname: string,
    fallback: T,
    options?: { timeoutMs?: number }
  ): Promise<{ ok: boolean; data: T; error?: string }> => {
    const timeoutMs = options?.timeoutMs ?? effectiveCodexFetchTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await dependencies.fetchJson<T>(withUser(pathname, url), {
        ...authInit(req),
        signal: controller.signal
      });
      return {
        ok: true,
        data: response
      };
    } catch (error) {
      return {
        ok: false,
        data: fallback,
        error: describeFetchError(error, timeoutMs)
      };
    } finally {
      clearTimeout(timer);
    }
  };
  const fallbackCodexDesktopSessionDetail = (sessionId: string, error?: string): CodexDesktopSessionDetail => ({
    session: {
      id: sessionId,
      title: `Codex Desktop ${sessionId}`,
      updatedAt: new Date().toISOString(),
      status: "unknown",
      source: "codex-desktop",
      canResume: false,
      canContinue: false,
      canStop: false,
      canCreateTask: false,
      unsupportedReason: error ?? "Codex Desktop session detail is temporarily unavailable.",
      unsupportedReasonCode: "CODEX_DESKTOP_DETAIL_UNAVAILABLE"
    },
    history: [],
    historyTruncated: false,
    historyUnsupportedReason: error
      ? `Codex Desktop session detail is temporarily unavailable: ${error}`
      : "Codex Desktop did not return session detail.",
    historyUnsupportedReasonCode: "CODEX_DESKTOP_HISTORY_UNAVAILABLE"
  });
  const desktopSessionLimitForRequest = (url: URL): number => {
    const rawLimit = Number(url.searchParams.get("limit"));
    if (Number.isInteger(rawLimit) && rawLimit > 0) {
      return Math.min(Math.max(rawLimit, 50), 200);
    }
    return url.searchParams.get("project") && url.searchParams.get("source") !== "codex-cli" ? 100 : 50;
  };
  const fetchCodexForRequest = async (req: { headers: Record<string, string | string[] | undefined> }, url: URL) => {
    const desktopSessionLimit = desktopSessionLimitForRequest(url);
    const [cliSessions, desktopProjects, desktopSessions] = await Promise.all([
      fetchForRequestWithFallback<{ sessions: MiniAppSessionCard[] }>(req, url, "/api/v1/miniapp/sessions", { sessions: [] }),
      fetchForRequestWithFallback<{ projects: CodexDesktopProject[] }>(req, url, "/api/v1/codex-desktop/projects", { projects: [] }),
      fetchForRequestWithFallback<{ sessions: CodexDesktopSession[] }>(req, url, `/api/v1/codex-desktop/sessions?limit=${desktopSessionLimit}`, { sessions: [] }, {
        timeoutMs: desktopSessionsFetchTimeoutMs(desktopSessionLimit)
      })
    ]);
    return {
      cliSessions: cliSessions.data.sessions,
      desktopProjects: desktopProjects.data.projects,
      desktopSessions: desktopSessions.data.sessions,
      desktopSessionLimit,
      load: {
        cliSessions: {
          ok: cliSessions.ok,
          error: cliSessions.error
        },
        desktopProjects: {
          ok: desktopProjects.ok,
          error: desktopProjects.error
        },
        desktopSessions: {
          ok: desktopSessions.ok,
          error: desktopSessions.error
        }
      }
    };
  };
  const postForRequest = <T>(
    req: { headers: Record<string, string | string[] | undefined> },
    url: URL,
    pathname: string,
    body: unknown
  ) => {
    const authorizationHeaders = authInit(req)?.headers as Record<string, string> | undefined;
    return dependencies.fetchJson<T>(withUser(pathname, url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorizationHeaders ?? {})
      },
      body: JSON.stringify(body)
    });
  };
  const renderForRequest = (
    req: { headers: Record<string, string | string[] | undefined> },
    title: string,
    body: string,
    options?: { needsAuth?: boolean; authResetSession?: boolean; navKey?: NavKey }
  ) => renderPage(title, body, {
    basePath: basePathFor(req),
    needsAuth: options?.needsAuth,
    authResetSession: options?.authResetSession,
    navKey: options?.navKey,
    browserApiBaseUrl: resolveBrowserApiBaseUrlForRequest(req.headers)
  });
  const requireSessionContext = (
    req: { headers: Record<string, string | string[] | undefined> },
    res: Parameters<typeof text>[0],
    url: URL,
    title: string,
    navKey: NavKey
  ): boolean => {
    if (hasSessionContext(req, url)) {
      return true;
    }

    html(res, 200, renderForRequest(req, title, renderAuthPending(), { needsAuth: true, navKey }));
    return false;
  };
  const navKeyForUrl = (url: URL): NavKey => {
    const screen = url.searchParams.get("screen");
    if (url.pathname.startsWith("/codex") || screen === "codex" || screen === "codex-session") {
      return "codex";
    }
    if (url.pathname.startsWith("/project") || url.pathname === "/projects" || url.pathname === "/new-task") {
      return "projects";
    }
    if (url.pathname.startsWith("/approval") || url.pathname === "/approvals" || screen === "approvals") {
      return "approvals";
    }
    if (url.pathname.startsWith("/host") || url.pathname === "/hosts") {
      return "hosts";
    }
    if (url.pathname.startsWith("/report") || url.pathname.startsWith("/task")) {
      return "reports";
    }
    if (url.pathname.startsWith("/session") || url.pathname.startsWith("/diff") || url.pathname.startsWith("/verify") || screen === "session" || screen === "diff" || screen === "verify" || screen === "sessions") {
      return "sessions";
    }
    return "home";
  };
  const titleForAuthRetry = (url: URL): string => {
    const navKey = navKeyForUrl(url);
    switch (navKey) {
      case "codex":
        return "Codex";
      case "sessions":
        return "Сессии";
      case "projects":
        return "Проекты";
      case "approvals":
        return "Подтверждения";
      case "hosts":
        return "Хосты";
      case "reports":
        return "Отчеты";
      case "home":
      default:
        return "HappyTG Mini App";
    }
  };
  const renderUnauthorizedFetchAsAuthPending = (context: {
    error: unknown;
    req: { method?: string; headers: Record<string, string | string[] | undefined> };
    res: Parameters<typeof text>[0];
    url?: URL;
  }): boolean => {
    if (!(context.error instanceof MiniAppFetchError) || context.error.status !== 401 || !context.url || context.req.method?.toUpperCase() !== "GET") {
      return false;
    }

    const navKey = navKeyForUrl(context.url);
    context.res.setHeader("set-cookie", expiredSessionCookieHeaders(context.req));
    html(context.res, 200, renderForRequest(context.req, titleForAuthRetry(context.url), renderAuthPending(), {
      needsAuth: true,
      authResetSession: true,
      navKey
    }));
    return true;
  };

  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        text(res, 200, "ok");
      }),
      route("GET", "/favicon.ico", async ({ res }) => {
        text(res, 204, "");
      }),
      route("HEAD", "/", async ({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("x-happytg-service", "miniapp");
        res.end();
      }),
      route("GET", "/ready", async ({ res }) => {
        try {
          await dependencies.fetchJson<{ ok: boolean }>("/health");
          json(res, 200, { ok: true, service: "miniapp", apiBaseUrl });
        } catch (error) {
          json(res, 503, {
            ok: false,
            service: "miniapp",
            apiBaseUrl,
            detail: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }),
      route("GET", "/", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "HappyTG Mini App", "home")) {
          return;
        }

        const screen = url.searchParams.get("screen");
        if (screen === "codex") {
          const codex = await fetchCodexForRequest(req, url);
          html(res, 200, renderForRequest(req, "Codex", renderCodexPanel({
            ...codex,
            source: url.searchParams.get("source") ?? "all",
            state: url.searchParams.get("state") ?? undefined,
            project: url.searchParams.get("project") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
            sort: url.searchParams.get("sort") ?? undefined,
            userId: url.searchParams.get("userId") ?? undefined
          }), { navKey: "codex" }));
          return;
        }
        if (screen === "codex-session" && url.searchParams.get("id")) {
          const id = url.searchParams.get("id")!;
          const detail = await fetchForRequestWithFallback<CodexDesktopSessionDetail>(req, url, `/api/v1/codex-desktop/sessions/${encodeURIComponent(id)}`, fallbackCodexDesktopSessionDetail(id));
          html(res, 200, renderForRequest(req, `Codex Desktop ${id}`, renderDesktopSessionDetail({
            ...detail.data,
            ...(detail.ok ? {} : { session: {
              ...detail.data.session,
              unsupportedReason: detail.data.session.unsupportedReason
                ? `${detail.data.session.unsupportedReason}${detail.error ? `: ${detail.error}` : ""}`
                : detail.error
                  ? `Session detail request failed: ${detail.error}`
                  : `Session detail request failed.`
            } })
          }, {
            historyOrder: url.searchParams.get("historyOrder") ?? undefined,
            userId: url.searchParams.get("userId") ?? undefined
          }), { navKey: "codex" }));
          return;
        }
        if (screen === "sessions") {
          const sessions = await fetchForRequest<{ sessions: MiniAppSessionCard[] }>(req, url, "/api/v1/miniapp/sessions");
          html(res, 200, renderForRequest(req, "Сессии", `<section class="panel hero"><h1>Сессии</h1><p class="muted">Операционный список с next action для каждой задачи.</p></section>${renderSessionCards(sessions.sessions)}`, { navKey: "sessions" }));
          return;
        }
        if (screen === "approvals") {
          const approvals = await fetchForRequest<{ approvals: MiniAppApprovalCard[] }>(req, url, "/api/v1/miniapp/approvals");
          html(res, 200, renderForRequest(req, "Подтверждения", `<section class="panel hero"><h1>Подтверждения</h1><p class="muted">Короткие решения по рисковым действиям.</p></section>${renderApprovalCards(approvals.approvals)}`, { navKey: "approvals" }));
          return;
        }
        if (screen === "session" && url.searchParams.get("id")) {
          const id = url.searchParams.get("id")!;
          const detail = await fetchForRequest<{
            session: MiniAppSessionCard & { prompt: string; currentSummary?: string; lastError?: string };
            task?: TaskBundle;
            approval?: MiniAppApprovalCard;
            events: SessionEvent[];
            actions: string[];
          }>(req, url, `/api/v1/miniapp/sessions/${encodeURIComponent(id)}`);
          html(res, 200, renderForRequest(req, `Сессия ${detail.session.id}`, renderSessionDetail(detail), { navKey: "sessions" }));
          return;
        }
        if (screen === "diff" && url.searchParams.get("sessionId")) {
          const diff = await fetchForRequest<MiniAppDiffProjection>(req, url, `/api/v1/miniapp/sessions/${encodeURIComponent(url.searchParams.get("sessionId")!)}/diff`);
          html(res, 200, renderForRequest(req, "Дифф", renderDiffView(diff), { navKey: "sessions" }));
          return;
        }
        if (screen === "verify" && url.searchParams.get("sessionId")) {
          const verify = await fetchForRequest<MiniAppVerifyProjection>(req, url, `/api/v1/miniapp/sessions/${encodeURIComponent(url.searchParams.get("sessionId")!)}/verify`);
          html(res, 200, renderForRequest(req, "Проверка", renderVerifyView(verify), { navKey: "sessions" }));
          return;
        }

        const dashboard = await fetchForRequest<MiniAppDashboardProjection>(req, url, "/api/v1/miniapp/dashboard");
        html(res, 200, renderForRequest(req, "HappyTG Mini App", renderDashboardView(dashboard), { navKey: "home" }));
      }),
      route("GET", "/sessions", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Сессии", "sessions")) {
          return;
        }

        const codex = await fetchCodexForRequest(req, url);
        html(res, 200, renderForRequest(req, "Сессии", renderCodexPanel({
          ...codex,
          source: url.searchParams.get("source") ?? "all",
          state: url.searchParams.get("state") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          sort: url.searchParams.get("sort") ?? undefined,
          userId: url.searchParams.get("userId") ?? undefined
        }), { navKey: "sessions" }));
      }),
      route("GET", "/codex", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Codex", "codex")) {
          return;
        }

        const codex = await fetchCodexForRequest(req, url);
        html(res, 200, renderForRequest(req, "Codex", renderCodexPanel({
          ...codex,
          source: url.searchParams.get("source") ?? "all",
          state: url.searchParams.get("state") ?? undefined,
          project: url.searchParams.get("project") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          sort: url.searchParams.get("sort") ?? undefined,
          resetHref: withUser("/codex", url),
          userId: url.searchParams.get("userId") ?? undefined
        }), { navKey: "codex" }));
      }),
      route("GET", "/codex/desktop-session", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Codex Desktop", "codex")) {
          return;
        }

        const id = url.searchParams.get("id");
        if (!id) {
          html(res, 404, renderForRequest(req, "Codex Desktop session not found", renderEmptyState("Desktop session не найдена", "Adapter did not return this session.", "Codex", "/codex?source=codex-desktop"), { navKey: "codex" }));
          return;
        }

        const detail = await fetchForRequestWithFallback<CodexDesktopSessionDetail>(req, url, `/api/v1/codex-desktop/sessions/${encodeURIComponent(id)}`, fallbackCodexDesktopSessionDetail(id));
        html(res, 200, renderForRequest(req, `Codex Desktop ${id}`, renderDesktopSessionDetail({
          ...detail.data,
          ...(detail.ok ? {} : { session: {
            ...detail.data.session,
            unsupportedReason: detail.data.session.unsupportedReason
              ? `${detail.data.session.unsupportedReason}${detail.error ? `: ${detail.error}` : ""}`
              : detail.error
                ? `Session detail request failed: ${detail.error}`
                : `Session detail request failed.`
          } })
        }, {
          historyOrder: url.searchParams.get("historyOrder") ?? undefined,
          userId: url.searchParams.get("userId") ?? undefined
        }), { navKey: "codex" }));
      }),
      route("GET", "/approvals", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Подтверждения", "approvals")) {
          return;
        }

        const approvals = await fetchForRequest<{ approvals: MiniAppApprovalCard[] }>(req, url, "/api/v1/miniapp/approvals");
        html(res, 200, renderForRequest(req, "Подтверждения", `<section class="panel hero"><h1>Подтверждения</h1><p class="muted">Approve/deny без длинных логов в чате.</p></section>${renderApprovalCards(approvals.approvals)}`, { navKey: "approvals" }));
      }),
      route("GET", "/approval/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Подтверждение", "approvals")) {
          return;
        }

        const detail = await fetchForRequest<{ approval: MiniAppApprovalCard; session?: MiniAppSessionCard }>(req, url, `/api/v1/miniapp/approvals/${params.id}`);
        const approvalActions = detail.approval.state === "waiting_human"
          ? `${approvalActionButton("Разрешить один раз", detail.approval, "approved", "once", true)}${approvalActionButton("Разрешить на фазу", detail.approval, "approved", "phase")}${approvalActionButton("Разрешить на сессию", detail.approval, "approved", "session")}${approvalActionButton("Отклонить", detail.approval, "rejected")}`
          : "";
        const body = `<section class="panel hero">
          <p class="eyebrow">Подтверждение</p>
          <h1>${escapeHtml(detail.approval.title)}</h1>
          <p class="muted">${escapeHtml(detail.approval.reason)}</p>
          <div class="notice notice-info" data-action-feedback hidden>Ждем действие.</div>
          <div class="grid">
            <div class="kv-item"><div class="eyebrow">Риск</div><strong>${escapeHtml(detail.approval.risk)}</strong></div>
            <div class="kv-item"><div class="eyebrow">Scope</div><strong>${escapeHtml(detail.approval.scope ?? "once")}</strong></div>
            <div class="kv-item"><div class="eyebrow">Истекает</div><strong>${escapeHtml(detail.approval.expiresAt)}</strong></div>
          </div>
          <div class="actions">${approvalActions}${detail.session ? linkButton("Открыть сессию", detail.session.href) : ""}</div>
        </section>`;
        html(res, 200, renderForRequest(req, `Подтверждение ${detail.approval.id}`, body, { navKey: "approvals" }));
      }),
      route("GET", "/hosts", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Хосты", "hosts")) {
          return;
        }

        const hosts = await fetchForRequest<{ hosts: MiniAppHostCard[] }>(req, url, "/api/v1/miniapp/hosts");
        html(res, 200, renderForRequest(req, "Хосты", `<section class="panel hero"><h1>Хосты</h1><p class="muted">Online state, repos and active sessions.</p></section>${renderHostCards(hosts.hosts)}`, { navKey: "hosts" }));
      }),
      route("GET", "/projects", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Проекты", "projects")) {
          return;
        }

        const [projects, desktopProjects] = await Promise.all([
          fetchForRequest<{ projects: MiniAppProjectCard[] }>(req, url, "/api/v1/miniapp/projects"),
          fetchForRequestWithFallback<{ projects: CodexDesktopProject[] }>(req, url, "/api/v1/codex-desktop/projects", { projects: [] })
        ]);
        html(res, 200, renderForRequest(req, "Проекты", renderProjectsView(projects.projects, desktopProjects.data.projects, {
          desktopProjectsLoad: {
            ok: desktopProjects.ok,
            error: desktopProjects.error
          },
          userId: url.searchParams.get("userId") ?? undefined
        }), { navKey: "projects" }));
      }),
      route("GET", "/projects/tasks", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Прошедшие задачи", "projects")) {
          return;
        }

        const data = await fetchCodexForRequest(req, url);
        html(res, 200, renderForRequest(req, "Прошедшие задачи", renderCodexPanel({
          cliSessions: data.cliSessions,
          desktopProjects: data.desktopProjects,
          desktopSessions: data.desktopSessions,
          desktopSessionLimit: data.desktopSessionLimit,
          load: data.load,
          source: url.searchParams.get("source") ?? "all",
          state: url.searchParams.get("state") ?? "all",
          project: url.searchParams.get("project") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          sort: url.searchParams.get("sort") ?? undefined,
          routePath: "/projects/tasks",
          resetHref: withUser("/projects", url),
          userId: url.searchParams.get("userId") ?? undefined
        }), { navKey: "projects" }));
      }),
      route("GET", "/project/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Проект", "projects")) {
          return;
        }

        const projects = await fetchForRequest<{ projects: MiniAppProjectCard[] }>(req, url, "/api/v1/miniapp/projects");
        const project = projects.projects.find((item) => item.id === params.id);
        if (!project) {
          html(res, 404, renderForRequest(req, "Проект не найден", renderEmptyState("Проект не найден", "Workspace is not available for this Mini App session.", "Проекты", "/projects"), { navKey: "projects" }));
          return;
        }

        const userId = url.searchParams.get("userId") ?? undefined;
        const body = `<section class="panel hero"><h1>${escapeHtml(project.repoName)}</h1><p class="meta-line">${escapeHtml(project.hostLabel ?? "host n/a")} · active ${project.activeSessions}</p><div class="actions">${linkButton("Новая задача", project.newSessionHref, true)}${linkButton("Вопрос", newTaskHref({ workspaceId: project.id, intent: "question", title: "Implementation question" }))}${linkButton("Прошедшие задачи", projectTasksHref("codex-cli", project.path, { userId }))}${linkButton("Projects", withUser("/projects", url))}</div>${renderDetails("Project details", [{ label: "path", value: project.path }, { label: "host", value: project.hostLabel }, { label: "branch", value: project.defaultBranch }])}</section>
          <section class="grid">
            <div class="kv-item"><div class="eyebrow">Runtime</div><strong>Codex CLI</strong></div>
            <div class="kv-item"><div class="eyebrow">Host</div><strong>${escapeHtml(project.hostLabel ?? "host n/a")}</strong></div>
            <div class="kv-item"><div class="eyebrow">Active sessions</div><strong>${project.activeSessions}</strong></div>
          </section>`;
        html(res, 200, renderForRequest(req, `Проект ${project.repoName}`, body, { navKey: "projects" }));
      }),
      route("GET", "/host/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Хост", "hosts")) {
          return;
        }

        const detail = await fetchForRequest<{ host: MiniAppHostCard; workspaces: Workspace[]; sessions: MiniAppSessionCard[] }>(req, url, `/api/v1/miniapp/hosts/${params.id}`);
        const body = `<section class="panel hero"><h1>${escapeHtml(detail.host.label)}</h1><p class="muted">${escapeHtml(detail.host.repoNames.join(", ") || "repos not reported")}</p><div class="actions">${linkButton("Использовать для новой задачи", "/new-task", true)}${linkButton("Проверить состояние", "/hosts")}</div></section>
          <section class="panel"><h2>Repos</h2><ul class="status-list">${detail.workspaces.map((workspace) => `<li><div><strong>${escapeHtml(workspace.repoName)}</strong><div class="muted">${escapeHtml(workspace.path)}</div></div><div class="status-meta">${renderBadge(workspace.status)}</div></li>`).join("")}</ul></section>
          <section class="panel"><h2>Sessions</h2>${renderSessionCards(detail.sessions)}</section>`;
        html(res, 200, renderForRequest(req, `Хост ${detail.host.label}`, body, { navKey: "hosts" }));
      }),
      route("GET", "/reports", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Отчеты", "reports")) {
          return;
        }

        const reports = await fetchForRequest<{ reports: MiniAppReportCard[] }>(req, url, "/api/v1/miniapp/reports");
        html(res, 200, renderForRequest(req, "Отчеты", `<section class="panel hero"><h1>Отчеты</h1><p class="muted">Proof-loop summaries вместо raw listing.</p></section>${renderReportCards(reports.reports)}`, { navKey: "reports" }));
      }),
      route("GET", "/diff/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Дифф", "sessions")) {
          return;
        }

        const diff = await fetchForRequest<MiniAppDiffProjection>(req, url, `/api/v1/miniapp/sessions/${params.id}/diff`);
        html(res, 200, renderForRequest(req, "Дифф", renderDiffView(diff), { navKey: "sessions" }));
      }),
      route("GET", "/verify/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Проверка", "sessions")) {
          return;
        }

        const verify = await fetchForRequest<MiniAppVerifyProjection>(req, url, `/api/v1/miniapp/sessions/${params.id}/verify`);
        html(res, 200, renderForRequest(req, "Проверка", renderVerifyView(verify), { navKey: "sessions" }));
      }),
      route("GET", "/new-task", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Новая задача", "projects")) {
          return;
        }

        const [projects, desktopProjects, desktopControl] = await Promise.all([
          fetchForRequest<{ projects: MiniAppProjectCard[] }>(req, url, "/api/v1/miniapp/projects"),
          fetchForRequestWithFallback<{ projects: CodexDesktopProject[] }>(req, url, "/api/v1/codex-desktop/projects", { projects: [] }),
          fetchForRequestWithFallback<{ control: CodexDesktopControlStatus }>(req, url, "/api/v1/codex-desktop/control", {
            control: {
              canResume: false,
              canContinue: false,
              canStop: false,
              canCreateTask: false,
              unsupportedReason: "Codex Desktop control contract is unavailable.",
              unsupportedReasonCode: "CODEX_DESKTOP_CONTROL_UNAVAILABLE"
            }
          })
        ]);
        html(res, 200, renderForRequest(req, "Новая задача", renderNewTaskForm(projects.projects, {
          hostId: url.searchParams.get("hostId") ?? undefined,
          workspaceId: url.searchParams.get("workspaceId") ?? undefined,
          source: url.searchParams.get("source") ?? undefined,
          projectId: url.searchParams.get("projectId") ?? undefined,
          intent: url.searchParams.get("intent") ?? undefined,
          title: url.searchParams.get("title") ?? undefined,
          contextSessionId: url.searchParams.get("contextSessionId") ?? undefined
        }, { projects: desktopProjects.data.projects, control: desktopControl.data.control }), { navKey: "projects" }));
      }),
      route("POST", "/codex/desktop-action", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Codex Desktop", "codex")) {
          return;
        }

        const body = await readJsonBody<{ sessionId?: string; action?: string }>(req);
        if (!body.sessionId || (body.action !== "resume" && body.action !== "stop")) {
          json(res, 400, { error: "Desktop sessionId and supported action are required" });
          return;
        }

        const result = await postForRequest<CodexDesktopControlResult>(req, url, `/api/v1/codex-desktop/sessions/${encodeURIComponent(body.sessionId)}/${body.action}`, {});
        json(res, 200, result);
      }),
      route("POST", "/codex/desktop-continue", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Codex Desktop", "codex")) {
          return;
        }

        const body = await readJsonBody<{ sessionId?: string; prompt?: string }>(req);
        if (!body.sessionId || !body.prompt?.trim()) {
          json(res, 400, { error: "Desktop sessionId and prompt are required" });
          return;
        }

        try {
          const result = await postForRequest<CodexDesktopControlResult>(req, url, `/api/v1/codex-desktop/sessions/${encodeURIComponent(body.sessionId)}/continue`, {
            prompt: body.prompt
          });
          json(res, 200, result);
        } catch (error) {
          if (error instanceof MiniAppFetchError) {
            json(res, error.status, {
              error: error.detail,
              detail: error.message
            });
            return;
          }
          throw error;
        }
      }),
      route("POST", "/new-task", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Новая задача", "projects")) {
          return;
        }

        const body = await readJsonBody<Omit<CreateSessionRequest, "userId" | "runtime"> & {
          runtime?: string;
          projectId?: string;
          projectPath?: string;
          intent?: string;
          contextSessionId?: string;
        }>(req);
        const prompt = buildMiniAppTaskPrompt(body);
        const { intent: _intent, contextSessionId: _contextSessionId, ...sessionBody } = body;
        const requestBody = {
          ...sessionBody,
          prompt
        };
        let desktopBody = requestBody;
        if (body.runtime === "codex-desktop" && body.projectId && !body.projectPath) {
          const desktopProjects = await fetchForRequest<{ projects: CodexDesktopProject[] }>(req, url, "/api/v1/codex-desktop/projects");
          const project = desktopProjects.projects.find((item) => item.id === body.projectId);
          desktopBody = {
            ...requestBody,
            projectPath: project?.path
          };
        }
        let created: NewTaskCreatedPayload;
        try {
          created = body.runtime === "codex-desktop"
            ? await postForRequest<CodexDesktopControlResult>(req, url, "/api/v1/codex-desktop/tasks", desktopBody)
            : await postForRequest<{ session: MiniAppSessionCard }>(req, url, "/api/v1/miniapp/sessions", {
                ...requestBody,
                runtime: "codex-cli"
              });
        } catch (error) {
          if (error instanceof MiniAppFetchError) {
            json(res, error.status, {
              error: error.detail,
              detail: error.message
            });
            return;
          }
          throw error;
        }
        json(res, 200, {
          ...created,
          sessionHref: newTaskSessionHref(created, body.runtime)
        });
      }),
      route("GET", "/task/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Задача", "reports")) {
          return;
        }

        const bundle = await fetchForRequest<{
          task: { id: string; rootPath: string; phase: string; verificationState: string };
          sections: Array<{ id: string; label: string; files: string[] }>;
          validation: { ok: boolean; missing: string[] };
        }>(req, url, `/api/v1/miniapp/tasks/${params.id}/bundle`);
        const artifactList = bundle.sections
          .flatMap((section) => section.files.map((file) => `${section.label}: ${file}`))
          .join("\n");
        const body = `
          <section class="panel">
            <div class="panel-header">
              <h1>Task ${escapeHtml(bundle.task.id)}</h1>
              ${renderBadge(bundle.task.verificationState)}
            </div>
            <div class="kv-grid">
              <div class="kv-item"><div class="eyebrow">Phase</div><strong>${escapeHtml(bundle.task.phase)}</strong></div>
              <div class="kv-item"><div class="eyebrow">Validation</div><strong>${escapeHtml(bundle.validation.ok ? "ok" : `missing ${bundle.validation.missing.join(", ")}`)}</strong></div>
              <div class="kv-item"><div class="eyebrow">Bundle path</div><code>${escapeHtml(bundle.task.rootPath)}</code></div>
            </div>
          </section>
          ${renderProofProgress(bundle.task)}
          <section class="panel">
            <h2>Artifacts</h2>
            <pre>${escapeHtml(artifactList || "No scoped artifacts available.")}</pre>
          </section>
        `;

        html(res, 200, renderForRequest(req, `Задача ${bundle.task.id}`, body, { navKey: "reports" }));
      }),
      route("GET", "/session/:id", async ({ req, res, params, url }) => {
        if (!requireSessionContext(req, res, url, "Сессия", "sessions")) {
          return;
        }

        const detail = await fetchForRequest<{
          session: MiniAppSessionCard & { prompt: string; currentSummary?: string; lastError?: string };
          task?: TaskBundle;
          approval?: MiniAppApprovalCard;
          events: SessionEvent[];
          actions: string[];
        }>(req, url, `/api/v1/miniapp/sessions/${params.id}`);
        html(res, 200, renderForRequest(req, `Сессия ${detail.session.id}`, renderSessionDetail(detail), { navKey: "sessions" }));
      })
    ],
    logger,
    {
      onError: renderUnauthorizedFetchAsAuthPending
    }
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createMiniAppServer();
  void startMiniAppServer(server).catch((error) => {
    console.error(error instanceof Error ? error.message : "Mini App failed to start.");
    process.exitCode = 1;
  });
}
