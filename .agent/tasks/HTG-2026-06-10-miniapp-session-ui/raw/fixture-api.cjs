const http = require("node:http");

const send = (res, payload, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const session = {
  id: "ses_visual",
  title: "Visual smoke result",
  state: "completed",
  runtime: "codex-cli",
  phase: "complete",
  verificationState: "passed",
  hostLabel: "devbox",
  repoName: "HappyTG",
  projectPath: "C:/Develop/Projects/HappyTG",
  lastUpdatedAt: "2026-06-10T20:30:00.000Z",
  href: "/session/ses_visual",
  nextAction: "open"
};

const project = {
  id: "ws_visual",
  hostId: "host_visual",
  hostLabel: "devbox",
  hostStatus: "active",
  repoName: "HappyTG",
  path: "C:/Develop/Projects/HappyTG",
  defaultBranch: "main",
  activeSessions: 1,
  href: "/project/ws_visual",
  newSessionHref: "/new-task?hostId=host_visual&workspaceId=ws_visual"
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4310");
  if (url.pathname === "/health") {
    send(res, { ok: true });
    return;
  }

  if (url.pathname === "/api/v1/miniapp/dashboard") {
    send(res, {
      stats: { activeSessions: 1, pendingApprovals: 0, blockedSessions: 0, verifyProblems: 0 },
      attention: [],
      recentSessions: [session],
      recentReports: [
        {
          id: "HTG-VISUAL",
          title: "Visual smoke result",
          status: "passed",
          generatedAt: "2026-06-10T20:30:00.000Z",
          href: "/task/HTG-VISUAL"
        }
      ]
    });
    return;
  }

  if (url.pathname === "/api/v1/miniapp/sessions") {
    send(res, { sessions: [session] });
    return;
  }

  if (url.pathname === "/api/v1/miniapp/projects") {
    send(res, { projects: [project] });
    return;
  }

  if (url.pathname === "/api/v1/codex-desktop/projects") {
    send(res, {
      projects: [
        {
          id: "cdp_visual",
          label: "HappyTG Desktop",
          path: "C:/Develop/Projects/HappyTG",
          source: "codex-desktop",
          active: true
        }
      ]
    });
    return;
  }

  if (url.pathname === "/api/v1/codex-desktop/sessions") {
    send(res, { sessions: [] });
    return;
  }

  if (url.pathname === "/api/v1/codex-desktop/control") {
    send(res, { control: { canResume: false, canStop: false, canCreateTask: true } });
    return;
  }

  send(res, { error: "not found", pathname: url.pathname }, 404);
}).listen(4310, "127.0.0.1", () => {
  console.log("fixture api 4310");
});
