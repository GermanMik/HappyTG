import { createJsonServer, createLogger, route, text } from "../../../packages/shared/src/index.js";

const logger = createLogger("miniapp");
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const port = Number(process.env.PORT ?? 3001);

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Mini App fetch failed for ${pathname}: ${response.status}`);
  }

  return (await response.json()) as T;
}

function renderPage(title: string, body: string): string {
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
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

const server = createJsonServer(
  [
    route("GET", "/health", async ({ res }) => {
      text(res, 200, "ok");
    }),
    route("GET", "/", async ({ res, url }) => {
      const userId = url.searchParams.get("userId");
      const overview = await fetchJson<{
        hosts: Array<{ id: string; label: string; status: string }>;
        sessions: Array<{ id: string; title: string; state: string; taskId?: string }>;
        approvals: Array<{ id: string; sessionId: string; state: string; reason: string }>;
        tasks: Array<{ id: string; phase: string; verificationState: string }>;
      }>(`/api/v1/miniapp/bootstrap${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);

      const body = `
        <section class="panel">
          <h1>HappyTG Mini App</h1>
          <p class="muted">Telegram-first render layer for deep inspection. Source of truth remains the control plane and repo-local task bundles.</p>
        </section>
        <section class="panel">
          <h2>Hosts</h2>
          <pre>${overview.hosts.map((host) => `${host.label} (${host.id}) state=${host.status}`).join("\n") || "No hosts found."}</pre>
        </section>
        <section class="panel">
          <h2>Sessions</h2>
          <ul>${overview.sessions.map((session) => `<li><a href="/session/${session.id}">${session.id}</a> state=${session.state} title=${session.title}${session.taskId ? ` task=${session.taskId}` : ""}</li>`).join("") || "<li>No sessions found.</li>"}</ul>
        </section>
        <section class="panel">
          <h2>Approvals</h2>
          <pre>${overview.approvals.map((approval) => `${approval.id} session=${approval.sessionId} state=${approval.state} reason=${approval.reason}`).join("\n") || "No approvals found."}</pre>
        </section>
        <section class="panel">
          <h2>Tasks</h2>
          <ul>${overview.tasks.map((task) => `<li><a href="/task/${task.id}">${task.id}</a> phase=${task.phase} verify=${task.verificationState}</li>`).join("") || "<li>No tasks found.</li>"}</ul>
        </section>
      `;

      text(res, 200, renderPage("HappyTG Mini App", body));
    }),
    route("GET", "/task/:id", async ({ res, params }) => {
      const task = await fetchJson<{
        task: { id: string; rootPath: string; phase: string; verificationState: string };
        validation: { ok: boolean; missing: string[] };
      }>(`/api/v1/tasks/${params.id}`);

      const artifacts = await fetchJson<{ artifacts: string[] }>(`/api/v1/tasks/${params.id}/artifacts`);
      const artifactSections = await Promise.all(
        ["spec.md", "evidence.md", "problems.md", "verdict.json"].map(async (artifact) => {
          const response = await fetchJson<{ path: string; content: string }>(`/api/v1/tasks/${params.id}/artifact?path=${encodeURIComponent(artifact)}`);
          return `<section class="panel"><h2>${artifact}</h2><pre>${response.content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></section>`;
        })
      );
      const body = `
        <section class="panel">
          <h1>Task ${task.task.id}</h1>
          <p>Phase: ${task.task.phase}</p>
          <p>Verification: ${task.task.verificationState}</p>
          <p>Bundle path: <code>${task.task.rootPath}</code></p>
          <p>Validation: ${task.validation.ok ? "ok" : `missing ${task.validation.missing.join(", ")}`}</p>
        </section>
        <section class="panel">
          <h2>Artifacts</h2>
          <pre>${artifacts.artifacts.join("\n")}</pre>
        </section>
        ${artifactSections.join("\n")}
      `;

      text(res, 200, renderPage(`Task ${task.task.id}`, body));
    }),
    route("GET", "/session/:id", async ({ res, params }) => {
      const timeline = await fetchJson<{
        session: { id: string; title: string; state: string; currentSummary?: string; lastError?: string };
        task?: { id: string; phase: string; verificationState: string };
        approval?: { id: string; state: string; reason: string };
        events: Array<{ sequence: number; type: string; occurredAt: string; payload: unknown }>;
      }>(`/api/v1/miniapp/session/${params.id}/timeline`);

      const body = `
        <section class="panel">
          <h1>Session ${timeline.session.id}</h1>
          <p>Title: ${timeline.session.title}</p>
          <p>State: ${timeline.session.state}</p>
          <p>Summary: ${timeline.session.currentSummary ?? "n/a"}</p>
          <p>Error: ${timeline.session.lastError ?? "n/a"}</p>
          <p>Task: ${timeline.task ? `<a href="/task/${timeline.task.id}">${timeline.task.id}</a> phase=${timeline.task.phase} verify=${timeline.task.verificationState}` : "n/a"}</p>
          <p>Approval: ${timeline.approval ? `${timeline.approval.id} state=${timeline.approval.state} reason=${timeline.approval.reason}` : "n/a"}</p>
        </section>
        <section class="panel">
          <h2>Timeline</h2>
          <pre>${timeline.events.map((event) => `${event.sequence}. ${event.occurredAt} ${event.type} ${JSON.stringify(event.payload)}`).join("\n") || "No events recorded."}</pre>
        </section>
      `;

      text(res, 200, renderPage(`Session ${timeline.session.id}`, body));
    })
  ],
  logger
);

server.listen(port, () => {
  logger.info("Mini App listening", { port, apiBaseUrl });
});
