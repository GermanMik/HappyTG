import { fileURLToPath } from "node:url";

import {
  createJsonServer,
  createLogger,
  json,
  loadHappyTGEnv,
  readPort,
  route,
  text,
  type Logger
} from "../../../packages/shared/src/index.js";

const logger = createLogger("miniapp");
loadHappyTGEnv();
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const port = readPort(process.env, ["HAPPYTG_MINIAPP_PORT", "PORT"], 3001);

export interface MiniAppDependencies {
  fetchJson<T>(pathname: string): Promise<T>;
}

async function defaultFetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Mini App fetch failed for ${pathname}: ${response.status}`);
  }

  return (await response.json()) as T;
}

const proofProgressSteps = [
  { phase: "init", label: "Init" },
  { phase: "spec_frozen", label: "Freeze/Spec" },
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

export function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        --bg: #f6f1e8;
        --panel: #fffaf2;
        --ink: #1d1c1a;
        --muted: #6f675c;
        --accent: #0c7c59;
        --border: #d6cab7;
      }
      body {
        margin: 0;
        padding: 24px;
        background: radial-gradient(circle at top left, #fef6de 0%, var(--bg) 55%, #ebe1d5 100%);
        color: var(--ink);
        font-family: Georgia, "Iowan Old Style", serif;
      }
      main {
        max-width: 980px;
        margin: 0 auto;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 20px;
        margin-bottom: 16px;
        box-shadow: 0 14px 40px rgba(20, 20, 20, 0.08);
      }
      h1, h2 {
        margin-top: 0;
      }
      code, pre {
        font-family: "SFMono-Regular", ui-monospace, monospace;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--accent);
      }
      ul {
        padding-left: 20px;
      }
      .muted {
        color: var(--muted);
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
        font-size: 12px;
        letter-spacing: 0.04em;
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
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-top: 1px solid rgba(214, 202, 183, 0.7);
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
        justify-content: flex-end;
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
        align-items: center;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.45);
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
        border-radius: 14px;
        border: 1px solid rgba(214, 202, 183, 0.8);
        background: rgba(255, 255, 255, 0.45);
      }
      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
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
      route("GET", "/", async ({ res, url }) => {
        const userId = url.searchParams.get("userId");
        const overview = await dependencies.fetchJson<{
          hosts: Array<{ id: string; label: string; status: string }>;
          sessions: Array<{ id: string; title: string; state: string; taskId?: string }>;
          approvals: Array<{ id: string; sessionId: string; state: string; reason: string }>;
          tasks: Array<{ id: string; phase: string; verificationState: string }>;
        }>(`/api/v1/miniapp/bootstrap${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);

        const body = `
          <section class="panel">
            <p class="eyebrow">Overview</p>
            <h1>HappyTG Mini App</h1>
            <p class="muted">Telegram-first render layer for deep inspection. Source of truth remains the control plane and repo-local task bundles.</p>
          </section>
          <section class="panel">
            <h2>Hosts</h2>
            <ul class="status-list">${overview.hosts.map((host) => `<li><div><strong>${escapeHtml(host.label)}</strong><div class="muted"><code>${escapeHtml(host.id)}</code></div></div><div class="status-meta">${renderBadge(host.status)}</div></li>`).join("") || "<li><span>No hosts found.</span></li>"}</ul>
          </section>
          <section class="panel">
            <h2>Sessions</h2>
            <ul class="status-list">${overview.sessions.map((session) => `<li><div><strong><a href="/session/${encodeURIComponent(session.id)}">${escapeHtml(session.id)}</a></strong><div class="muted">${escapeHtml(session.title)}${session.taskId ? ` · task ${escapeHtml(session.taskId)}` : ""}</div></div><div class="status-meta">${renderBadge(session.state)}</div></li>`).join("") || "<li><span>No sessions found.</span></li>"}</ul>
          </section>
          <section class="panel">
            <h2>Approvals</h2>
            <ul class="status-list">${overview.approvals.map((approval) => `<li><div><strong>${escapeHtml(approval.id)}</strong><div class="muted">session ${escapeHtml(approval.sessionId)} · ${escapeHtml(approval.reason)}</div></div><div class="status-meta">${renderBadge(approval.state)}</div></li>`).join("") || "<li><span>No approvals found.</span></li>"}</ul>
          </section>
          <section class="panel">
            <h2>Tasks</h2>
            <ul class="status-list">${overview.tasks.map((task) => `<li><div><strong><a href="/task/${encodeURIComponent(task.id)}">${escapeHtml(task.id)}</a></strong><div class="muted">phase ${escapeHtml(task.phase)}</div></div><div class="status-meta">${renderBadge(task.verificationState)}</div></li>`).join("") || "<li><span>No tasks found.</span></li>"}</ul>
          </section>
        `;

        text(res, 200, renderPage("HappyTG Mini App", body));
      }),
      route("GET", "/task/:id", async ({ res, params }) => {
        const task = await dependencies.fetchJson<{
          task: { id: string; rootPath: string; phase: string; verificationState: string };
          validation: { ok: boolean; missing: string[] };
        }>(`/api/v1/tasks/${params.id}`);

        const artifacts = await dependencies.fetchJson<{ artifacts: string[] }>(`/api/v1/tasks/${params.id}/artifacts`);
        const artifactSections = await Promise.all(
          ["spec.md", "evidence.md", "problems.md", "verdict.json"].map(async (artifact) => {
            const response = await dependencies.fetchJson<{ path: string; content: string }>(`/api/v1/tasks/${params.id}/artifact?path=${encodeURIComponent(artifact)}`);
            return `<section class="panel"><h2>${escapeHtml(artifact)}</h2><pre>${escapeHtml(response.content)}</pre></section>`;
          })
        );
        const body = `
          <section class="panel">
            <div class="panel-header">
              <h1>Task ${escapeHtml(task.task.id)}</h1>
              ${renderBadge(task.task.verificationState)}
            </div>
            <div class="kv-grid">
              <div class="kv-item"><div class="eyebrow">Phase</div><strong>${escapeHtml(task.task.phase)}</strong></div>
              <div class="kv-item"><div class="eyebrow">Validation</div><strong>${escapeHtml(task.validation.ok ? "ok" : `missing ${task.validation.missing.join(", ")}`)}</strong></div>
              <div class="kv-item"><div class="eyebrow">Bundle path</div><code>${escapeHtml(task.task.rootPath)}</code></div>
            </div>
          </section>
          ${renderProofProgress(task.task)}
          <section class="panel">
            <h2>Artifacts</h2>
            <pre>${escapeHtml(artifacts.artifacts.join("\n"))}</pre>
          </section>
          ${artifactSections.join("\n")}
        `;

        text(res, 200, renderPage(`Task ${task.task.id}`, body));
      }),
      route("GET", "/session/:id", async ({ res, params }) => {
        const timeline = await dependencies.fetchJson<{
          session: { id: string; title: string; state: string; currentSummary?: string; lastError?: string };
          task?: { id: string; phase: string; verificationState: string };
          approval?: { id: string; state: string; reason: string };
          events: Array<{ sequence: number; type: string; occurredAt: string; payload: unknown }>;
        }>(`/api/v1/miniapp/session/${params.id}/timeline`);

        const body = `
          <section class="panel">
            <div class="panel-header">
              <h1>Session ${escapeHtml(timeline.session.id)}</h1>
              ${renderBadge(timeline.session.state)}
            </div>
            <div class="kv-grid">
              <div class="kv-item"><div class="eyebrow">Title</div><strong>${escapeHtml(timeline.session.title)}</strong></div>
              <div class="kv-item"><div class="eyebrow">Summary</div><strong>${escapeHtml(timeline.session.currentSummary ?? "n/a")}</strong></div>
              <div class="kv-item"><div class="eyebrow">Last error</div><strong>${escapeHtml(timeline.session.lastError ?? "n/a")}</strong></div>
              <div class="kv-item"><div class="eyebrow">Approval</div><strong>${timeline.approval ? `${escapeHtml(timeline.approval.id)} · ${escapeHtml(timeline.approval.reason)}` : "n/a"}</strong></div>
            </div>
            <p>Task: ${timeline.task ? `<a href="/task/${encodeURIComponent(timeline.task.id)}">${escapeHtml(timeline.task.id)}</a> phase=${escapeHtml(timeline.task.phase)} verify=${escapeHtml(timeline.task.verificationState)}` : "n/a"}</p>
          </section>
          ${timeline.task ? renderProofProgress(timeline.task, { sessionState: timeline.session.state }) : ""}
          <section class="panel">
            <h2>Timeline</h2>
            <pre>${escapeHtml(timeline.events.map((event) => `${event.sequence}. ${event.occurredAt} ${event.type} ${JSON.stringify(event.payload)}`).join("\n") || "No events recorded.")}</pre>
          </section>
        `;

        text(res, 200, renderPage(`Session ${timeline.session.id}`, body));
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
