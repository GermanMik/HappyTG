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

async function defaultFetchJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, apiBaseUrl), init);
  if (!response.ok) {
    throw new Error(`Mini App fetch failed for ${pathname}: ${response.status}`);
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

type NavKey = "home" | "sessions" | "projects" | "approvals" | "hosts" | "reports";

export function renderPage(
  title: string,
  body: string,
  options?: { basePath?: string; needsAuth?: boolean; browserApiBaseUrl?: string; navKey?: NavKey }
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
        --bg: #f2f5ef;
        --bg-accent: radial-gradient(circle at top left, rgba(21, 132, 108, 0.18), transparent 34%), radial-gradient(circle at top right, rgba(28, 93, 153, 0.12), transparent 28%), linear-gradient(180deg, #f8fbf7 0%, #eef2ee 100%);
        --surface: rgba(255, 255, 255, 0.88);
        --surface-soft: #eef6f3;
        --surface-strong: #f5fbf8;
        --ink: #17312b;
        --muted: #5e6e69;
        --accent: #0d7f66;
        --accent-strong: #095847;
        --warn: #9a6700;
        --danger: #b42318;
        --info: #1c5d99;
        --border: rgba(23, 49, 43, 0.12);
        --shadow: 0 18px 36px rgba(17, 36, 31, 0.08);
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
        border-radius: 20px;
        padding: 16px;
        margin-bottom: 14px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }
      .hero {
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(238, 246, 243, 0.94) 55%, rgba(245, 251, 248, 0.92) 100%);
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
        font-size: 26px;
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
        padding: 14px 0;
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
        border-radius: 16px;
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
        border-radius: 16px;
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
        border-radius: 14px;
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
        border-radius: 16px;
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
        border-radius: 14px;
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
        border-radius: 16px;
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
      textarea, input, select {
        width: 100%;
        min-height: 46px;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
        font: inherit;
        background: rgba(255, 255, 255, 0.95);
      }
      textarea {
        min-height: 108px;
        resize: vertical;
      }
      @media (min-width: 760px) {
        body {
          padding: 24px 24px 96px;
        }
        h1 {
          font-size: 34px;
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
        document.querySelector("[data-new-task-form]")?.addEventListener("submit", function (event) {
          event.preventDefault();
          var form = event.currentTarget;
          var submit = form.querySelector("[type=submit]");
          var feedback = form.querySelector("[data-task-feedback]");
          if (submit) submit.disabled = true;
          if (submit) submit.textContent = "Создаем...";
          setActionFeedback(feedback, "info", "Создаем сессию и готовим переход к деталям.");
          var data = new FormData(form);
          fetch(location.pathname + location.search, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              hostId: data.get("hostId"),
              workspaceId: data.get("workspaceId"),
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

function renderBottomNav(active?: NavKey): string {
  const items: Array<{ key: NavKey; href: string; label: string }> = [
    { key: "home", href: "/", label: "Главная" },
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

function renderDashboardView(dashboard: MiniAppDashboardProjection): string {
  const attention = dashboard.attention.length > 0
    ? `<ul class="status-list">${dashboard.attention.map((item) => `<li>
        <div><strong>${escapeHtml(item.title)}</strong><div class="muted">${escapeHtml(item.detail)}</div></div>
        <div class="status-meta">${renderBadge(item.severity)}${linkButton(item.nextAction, item.href)}</div>
      </li>`).join("")}</ul>`
    : renderEmptyState("Сейчас ничего не требует внимания", "Активные проблемы, approvals и verify failures появятся здесь.", "Открыть sessions", "/sessions");

  return `
    <section class="panel hero">
      <p class="eyebrow">Что важно сейчас</p>
      <h1>Панель управления HappyTG</h1>
      <p class="muted">Короткий статус, быстрые действия и переход к деталям без чтения raw logs.</p>
      <div class="actions">
        ${linkButton("Новая задача", "/new-task", true)}
        ${linkButton("Проекты", "/projects")}
        ${linkButton("Подтверждения", "/approvals")}
        ${dashboard.recentSessions[0] ? linkButton("Продолжить последнюю", dashboard.recentSessions[0].href) : ""}
      </div>
    </section>
    <section class="grid">
      <div class="kv-item"><div class="eyebrow">Активные</div><strong>${dashboard.stats.activeSessions}</strong></div>
      <div class="kv-item"><div class="eyebrow">Подтв.</div><strong>${dashboard.stats.pendingApprovals}</strong></div>
      <div class="kv-item"><div class="eyebrow">Блокеры</div><strong>${dashboard.stats.blockedSessions}</strong></div>
      <div class="kv-item"><div class="eyebrow">Verify</div><strong>${dashboard.stats.verifyProblems}</strong></div>
    </section>
    <section class="panel">
      <h2>Требует внимания</h2>
      ${attention}
    </section>
    <section class="panel">
      <h2>Активные и последние сессии</h2>
      ${renderSessionCards(dashboard.recentSessions)}
    </section>
    <section class="panel">
      <h2>Последние отчеты</h2>
      ${renderReportCards(dashboard.recentReports)}
    </section>
  `;
}

function runtimeLabel(runtime: string | undefined): string {
  return runtime === "codex-cli" ? "Codex CLI" : runtime ?? "runtime n/a";
}

function renderSessionCards(sessions: MiniAppSessionCard[]): string {
  if (sessions.length === 0) {
    return renderEmptyState("Нет активных сессий", "Когда host будет подключен, новая задача появится здесь.", "Проверить hosts", "/hosts");
  }

  return `<ul class="status-list">${sessions.map((session) => `<li>
    <div>
      <strong><a href="${escapeHtml(session.href)}">${escapeHtml(session.title)}</a></strong>
      <div class="muted">${escapeHtml(runtimeLabel(session.runtime))} · ${escapeHtml(session.repoName ?? "repo not selected")} · ${escapeHtml(session.hostLabel ?? "host n/a")} · ${escapeHtml(session.lastUpdatedAt)}</div>
      ${session.attention ? `<div class="muted">Needs: ${escapeHtml(session.attention)}</div>` : ""}
    </div>
    <div class="status-meta">${renderBadge(session.state)}${session.phase ? renderBadge(session.phase, "info") : ""}${session.verificationState ? renderBadge(session.verificationState) : ""}${linkButton(session.nextAction, session.href)}</div>
  </li>`).join("")}</ul>`;
}

function renderProjectCards(projects: MiniAppProjectCard[]): string {
  if (projects.length === 0) {
    return renderEmptyState("Проекты не найдены", "Подключите host daemon и дождитесь hello со списком workspaces.", "Проверить хосты", "/hosts");
  }

  return `<ul class="status-list">${projects.map((project) => `<li>
    <div>
      <strong><a href="${escapeHtml(project.href)}">${escapeHtml(project.repoName)}</a></strong>
      <div class="muted">${escapeHtml(project.path)} · ${escapeHtml(project.hostLabel ?? "host n/a")}${project.defaultBranch ? ` · ${escapeHtml(project.defaultBranch)}` : ""}</div>
    </div>
    <div class="status-meta">${project.hostStatus ? renderBadge(project.hostStatus) : ""}${renderBadge(`active ${project.activeSessions}`, "info")}${linkButton("Новая задача", project.newSessionHref, true)}</div>
  </li>`).join("")}</ul>`;
}

function renderNewTaskForm(projects: MiniAppProjectCard[], selected?: { hostId?: string; workspaceId?: string }): string {
  const selectedWorkspaceId = selected?.workspaceId ?? projects[0]?.id;
  const selectedProject = projects.find((project) => project.id === selectedWorkspaceId) ?? projects[0];
  const options = projects.map((project) => `<option value="${escapeHtml(project.id)}" data-host-id="${escapeHtml(project.hostId)}"${project.id === selectedProject?.id ? " selected" : ""}>${escapeHtml(project.repoName)} · ${escapeHtml(project.hostLabel ?? "host n/a")}</option>`).join("");

  return `<section class="panel hero">
    <h1>Новая Codex-задача</h1>
    <p class="muted">Выберите project/workspace, задайте инструкцию и создайте Codex CLI session через backend.</p>
  </section>
  <section class="panel">
    ${projects.length === 0 ? renderEmptyState("Нет доступных проектов", "Сначала подключите host daemon, чтобы HappyTG получил список workspaces.", "Проверить hosts", "/hosts") : `<form data-new-task-form>
      <input type="hidden" name="hostId" value="${escapeHtml(selectedProject?.hostId ?? selected?.hostId ?? "")}">
      <div class="notice notice-info" data-task-feedback hidden>Создаем сессию.</div>
      <label class="eyebrow" for="workspaceId">Проект</label>
      <select id="workspaceId" name="workspaceId" onchange="this.form.hostId.value = this.options[this.selectedIndex].getAttribute('data-host-id') || ''">${options}</select>
      <label class="eyebrow" for="mode">Режим</label>
      <select id="mode" name="mode">
        <option value="proof" selected>proof</option>
        <option value="quick">quick</option>
      </select>
      <label class="eyebrow" for="title">Название</label>
      <input id="title" name="title" value="Mini App task">
      <label class="eyebrow" for="task-draft">Инструкция</label>
      <textarea id="task-draft" name="prompt" data-draft placeholder="Опишите задачу коротко и конкретно"></textarea>
      <label class="eyebrow" for="acceptanceCriteria">Критерии приемки</label>
      <textarea id="acceptanceCriteria" name="acceptanceCriteria" placeholder="Каждый критерий с новой строки"></textarea>
      <div class="actions"><button class="button button-primary" type="submit">Создать Codex-сессию</button>${linkButton("Отмена", "/projects")}</div>
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
  return `
    <section class="panel hero">
      <p class="eyebrow">Session</p>
      <h1>${escapeHtml(detail.session.title)}</h1>
      <p class="muted">${escapeHtml(runtimeLabel(detail.session.runtime))} · ${escapeHtml(detail.session.repoName ?? "repo n/a")} · ${escapeHtml(detail.session.hostLabel ?? "host n/a")}</p>
      <div class="actions">
        ${detail.approval && detail.approval.state === "waiting_human" ? linkButton("Открыть approval", detail.approval.href, true) : ""}
        ${detail.task ? linkButton("Proof timeline", `/task/${encodeURIComponent(detail.task.id)}`) : ""}
        ${linkButton("Diff", `/diff/${encodeURIComponent(detail.session.id)}`)}
        ${linkButton("Verify", `/verify/${encodeURIComponent(detail.session.id)}`)}
      </div>
    </section>
    <section class="grid">
      <div class="kv-item"><div class="eyebrow">Status</div><strong>${escapeHtml(detail.session.state)}</strong></div>
      <div class="kv-item"><div class="eyebrow">Runtime</div><strong>${escapeHtml(runtimeLabel(detail.session.runtime))}</strong></div>
      <div class="kv-item"><div class="eyebrow">Phase</div><strong>${escapeHtml(detail.session.phase ?? "n/a")}</strong></div>
      <div class="kv-item"><div class="eyebrow">Verify</div><strong>${escapeHtml(detail.session.verificationState ?? "not_started")}</strong></div>
    </section>
    <section class="panel">
      <h2>Summary</h2>
      <p>${escapeHtml(detail.session.currentSummary ?? "Сводки пока нет.")}</p>
      ${detail.session.lastError ? `<p class="muted">${escapeHtml(detail.session.lastError)}</p>` : ""}
    </section>
    ${detail.task ? renderProofProgress(detail.task, { sessionState: detail.session.state }) : ""}
    <section class="panel">
      <h2>Timeline</h2>
      <ol class="timeline">${detail.events.map((event) => `<li><strong>${event.sequence}. ${escapeHtml(event.type)}</strong><div class="muted">${escapeHtml(event.occurredAt)}</div><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></li>`).join("") || "<li>No events recorded.</li>"}</ol>
    </section>
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
    options?: { needsAuth?: boolean; navKey?: NavKey }
  ) => renderPage(title, body, {
    basePath: basePathFor(req),
    needsAuth: options?.needsAuth,
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

  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        text(res, 200, "ok");
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

        const sessions = await fetchForRequest<{ sessions: MiniAppSessionCard[] }>(req, url, "/api/v1/miniapp/sessions");
        html(res, 200, renderForRequest(req, "Сессии", `<section class="panel hero"><h1>Сессии</h1><p class="muted">Статус, фаза, verify и следующий шаг в одном месте.</p></section>${renderSessionCards(sessions.sessions)}`, { navKey: "sessions" }));
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
          ? `${approvalActionButton("Разрешить один раз", detail.approval, "approved", "once", true)}${approvalActionButton("Разрешить на фазу", detail.approval, "approved", "phase")}${approvalActionButton("Отклонить", detail.approval, "rejected")}`
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

        const projects = await fetchForRequest<{ projects: MiniAppProjectCard[] }>(req, url, "/api/v1/miniapp/projects");
        html(res, 200, renderForRequest(req, "Проекты", `<section class="panel hero"><h1>Проекты</h1><p class="muted">Workspaces reported by paired hosts. Start a Codex CLI session from the project you want to operate on.</p></section>${renderProjectCards(projects.projects)}`, { navKey: "projects" }));
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

        const body = `<section class="panel hero"><h1>${escapeHtml(project.repoName)}</h1><p class="muted">${escapeHtml(project.path)}</p><div class="actions">${linkButton("Новая задача", project.newSessionHref, true)}${linkButton("Projects", "/projects")}</div></section>
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

        const projects = await fetchForRequest<{ projects: MiniAppProjectCard[] }>(req, url, "/api/v1/miniapp/projects");
        html(res, 200, renderForRequest(req, "Новая задача", renderNewTaskForm(projects.projects, {
          hostId: url.searchParams.get("hostId") ?? undefined,
          workspaceId: url.searchParams.get("workspaceId") ?? undefined
        }), { navKey: "projects" }));
      }),
      route("POST", "/new-task", async ({ req, res, url }) => {
        if (!requireSessionContext(req, res, url, "Новая задача", "projects")) {
          return;
        }

        const body = await readJsonBody<Omit<CreateSessionRequest, "userId" | "runtime">>(req);
        const created = await postForRequest<{ session: MiniAppSessionCard }>(req, url, "/api/v1/miniapp/sessions", {
          ...body,
          runtime: "codex-cli"
        });
        json(res, 200, {
          ...created,
          sessionHref: created.session.href
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
    logger
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createMiniAppServer();
  void startMiniAppServer(server).catch((error) => {
    console.error(error instanceof Error ? error.message : "Mini App failed to start.");
    process.exitCode = 1;
  });
}
