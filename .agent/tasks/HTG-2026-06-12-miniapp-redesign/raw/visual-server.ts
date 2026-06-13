import { createMiniAppServer } from "../../../../apps/miniapp/src/index.js";

const now = "2026-06-12T12:00:00.000Z";
const session = {
  id: "ses_1",
  title: "Разработать dashboard",
  state: "running",
  runtime: "codex-cli",
  phase: "build",
  verificationState: "running",
  hostLabel: "RTX-PC",
  repoName: "HappyTG",
  projectPath: "C:/Develop/Projects/HappyTG",
  lastUpdatedAt: now,
  attention: "verify",
  href: "/session/ses_1",
  nextAction: "open verify"
};
const desktopSession = {
  id: "desktop_1",
  title: "Mini App UI pass",
  projectPath: "C:/Develop/Projects/HappyTG",
  projectId: "cdp_1",
  updatedAt: now,
  status: "active",
  source: "codex-desktop",
  canResume: true,
  canContinue: true,
  canStop: true,
  canCreateTask: true
};
const project = {
  id: "ws_1",
  hostId: "host_1",
  hostLabel: "RTX-PC",
  hostStatus: "active",
  repoName: "HappyTG",
  path: "C:/Develop/Projects/HappyTG",
  defaultBranch: "main",
  activeSessions: 2,
  href: "/project/ws_1",
  newSessionHref: "/new-task?hostId=host_1&workspaceId=ws_1"
};
const desktopProject = {
  id: "cdp_1",
  label: "HappyTG",
  path: "C:/Develop/Projects/HappyTG",
  source: "codex-desktop",
  active: true
};
const approval = {
  id: "apr_1",
  sessionId: "ses_1",
  title: "Codex хочет применить изменения",
  state: "waiting_human",
  reason: "1 файл требует подтверждения",
  risk: "medium",
  expiresAt: now,
  scope: "once",
  nonce: "nonce_1",
  href: "/approval/apr_1"
};
const host = {
  id: "host_1",
  label: "RTX-PC",
  status: "active",
  activeSessions: 2,
  repoNames: ["HappyTG"],
  href: "/host/host_1"
};

const server = createMiniAppServer({
  async fetchJson(pathname) {
    const path = pathname.replace(/\?userId=usr_1$/u, "");
    if (path === "/health") return { ok: true };
    if (path === "/api/v1/miniapp/dashboard") return {
      stats: { activeSessions: 2, pendingApprovals: 1, blockedSessions: 0, verifyProblems: 1 },
      lastContext: { hostId: "host_1", hostLabel: "RTX-PC", workspaceId: "ws_1", repoName: "HappyTG" },
      attention: [{ id: "apr_1", kind: "approval", title: "Требует внимания", detail: "1 approval ожидает решения", severity: "warn", href: "/approval/apr_1", nextAction: "open approval" }],
      recentSessions: [session],
      recentReports: [{ id: "HTG-smoke", title: "HappyTG dashboard proof", status: "running", generatedAt: now, href: "/task/HTG-smoke" }]
    };
    if (path === "/api/v1/miniapp/sessions") return { sessions: [session] };
    if (path === "/api/v1/miniapp/sessions/ses_1") return { session: { ...session, prompt: "Smoke", currentSummary: "Codex редактирует UI компоненты" }, events: [{ sequence: 1, occurredAt: now, type: "SessionCreated", payload: { ok: true } }], actions: ["diff"] };
    if (path === "/api/v1/miniapp/projects") return { projects: [project] };
    if (path === "/api/v1/codex-desktop/projects") return { projects: [desktopProject] };
    if (path === "/api/v1/codex-desktop/sessions?limit=50" || path === "/api/v1/codex-desktop/sessions?limit=100") return { sessions: [desktopSession] };
    if (path === "/api/v1/codex-desktop/sessions/desktop_1") return { session: desktopSession, history: [{ id: "h1", sequence: 1, occurredAt: now, kind: "message", role: "assistant", summary: "Изменены 3 файла", source: "codex-desktop" }], historyTruncated: false };
    if (path === "/api/v1/codex-desktop/control") return { control: { canResume: true, canContinue: true, canStop: true, canCreateTask: true } };
    if (path === "/api/v1/miniapp/approvals") return { approvals: [approval] };
    if (path === "/api/v1/miniapp/approvals/apr_1") return { approval, session };
    if (path === "/api/v1/miniapp/sessions/ses_1/diff") return { sessionId: "ses_1", summary: { changedFiles: 3, highRiskFiles: [] }, files: [{ path: "apps/miniapp/src/index.ts", category: "code", status: "modified", summary: "UI redesign" }], rawAvailable: true };
    if (path === "/api/v1/miniapp/sessions/ses_1/verify") return { sessionId: "ses_1", state: "running", checkedCriteria: ["routes render"], failedCriteria: [], nextAction: "open", evidenceHref: "/task/HTG-smoke" };
    if (path === "/api/v1/miniapp/hosts") return { hosts: [host] };
    if (path === "/api/v1/miniapp/hosts/host_1") return { host, workspaces: [{ id: "ws_1", hostId: "host_1", repoName: "HappyTG", path: "C:/Develop/Projects/HappyTG", status: "active" }], sessions: [session] };
    if (path === "/api/v1/miniapp/reports") return { reports: [{ id: "HTG-smoke", title: "HappyTG dashboard proof", status: "running", generatedAt: now, href: "/task/HTG-smoke" }] };
    if (path === "/api/v1/miniapp/tasks/HTG-smoke/bundle") return { task: { id: "HTG-smoke", rootPath: ".agent/tasks/HTG-smoke", phase: "verify", verificationState: "running" }, sections: [{ id: "spec", label: "Spec", files: ["spec.md"] }], validation: { ok: true, missing: [] } };
    throw new Error(`Unexpected path ${pathname}`);
  }
});

const port = Number(process.env.HAPPYTG_VISUAL_PORT ?? "3999");
server.listen(port, "127.0.0.1", () => {
  console.log(`Visual Mini App mock listening on http://127.0.0.1:${port}`);
});
