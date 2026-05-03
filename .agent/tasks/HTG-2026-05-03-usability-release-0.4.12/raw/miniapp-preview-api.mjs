import { createServer } from "node:http";

const port = Number(process.env.PREVIEW_API_PORT ?? 4108);

const dashboard = {
  stats: {
    activeSessions: 2,
    pendingApprovals: 1,
    blockedSessions: 0,
    verifyProblems: 1
  },
  lastContext: {
    hostId: "host-local",
    hostLabel: "Local Windows",
    workspaceId: "happy",
    repoName: "HappyTG"
  },
  attention: [
    {
      title: "Нужно подтвердить действие",
      detail: "Сессия релизного UX-pass ждет решение по рискованной операции.",
      severity: "warn",
      href: "/approvals/approval-release-preview?userId=release-preview",
      nextAction: "approval"
    },
    {
      title: "Verify требует внимания",
      detail: "Откройте проверку, чтобы увидеть короткий итог и evidence.",
      severity: "info",
      href: "/verify/session-release-preview?userId=release-preview",
      nextAction: "verify"
    }
  ],
  recentSessions: [
    {
      id: "session-release-preview",
      title: "Release UX verification",
      state: "running",
      runtime: "codex-cli",
      source: "codex-cli",
      phase: "verify",
      verificationState: "running",
      hostLabel: "Local Windows",
      repoName: "HappyTG",
      lastUpdatedAt: "2026-05-03T16:10:00+03:00",
      attention: "verify",
      href: "/session/session-release-preview?userId=release-preview",
      nextAction: "verify",
      canResume: true,
      canStop: true
    },
    {
      id: "desktop-preview",
      title: "Codex Desktop triage",
      state: "paused",
      runtime: "codex-desktop",
      source: "codex-desktop",
      desktopStatus: "active",
      hostLabel: "Local Windows",
      repoName: "HappyTG",
      lastUpdatedAt: "2026-05-03T16:08:00+03:00",
      href: "/codex/desktop-session?id=desktop-preview&userId=release-preview",
      nextAction: "open",
      unsupportedReasonCode: "CODEX_DESKTOP_CONTROL_UNSUPPORTED",
      unsupportedReason: "Stable Codex Desktop control contract is unavailable."
    }
  ],
  recentReports: [
    {
      id: "report-release-preview",
      title: "HTG-2026-05-03-usability-design-pass",
      status: "passed",
      generatedAt: "2026-05-03T16:05:00+03:00",
      href: "/tasks/HTG-2026-05-03-usability-design-pass?userId=release-preview"
    }
  ]
};

const sessions = { sessions: dashboard.recentSessions };
const approvals = {
  approvals: [
    {
      id: "approval-release-preview",
      sessionId: "session-release-preview",
      title: "Разрешить scoped host command",
      reason: "Команда изменяет release metadata и требует явного решения.",
      risk: "medium",
      state: "pending",
      expiresAt: "2026-05-03T16:30:00+03:00",
      scope: "session",
      nonce: "preview",
      href: "/approvals/approval-release-preview?userId=release-preview"
    }
  ]
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(payload));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/v1/miniapp/dashboard") {
    sendJson(res, 200, dashboard);
    return;
  }
  if (url.pathname === "/api/v1/miniapp/sessions") {
    sendJson(res, 200, sessions);
    return;
  }
  if (url.pathname === "/api/v1/miniapp/approvals") {
    sendJson(res, 200, approvals);
    return;
  }
  if (url.pathname === "/api/v1/codex-desktop/projects") {
    sendJson(res, 200, { projects: [] });
    return;
  }
  if (url.pathname === "/api/v1/codex-desktop/sessions") {
    sendJson(res, 200, { sessions: [] });
    return;
  }
  sendJson(res, 404, { error: "not_found", path: url.pathname });
}).listen(port, "127.0.0.1", () => {
  console.log(`Mini App preview API listening on http://127.0.0.1:${port}`);
});
