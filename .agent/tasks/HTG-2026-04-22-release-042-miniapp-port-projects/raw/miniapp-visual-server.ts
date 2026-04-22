import { createMiniAppServer } from "../../../../apps/miniapp/src/index.js";

const sessions = [
  {
    id: "ses_visual",
    title: "Proof task: verify HappyTG release",
    state: "running",
    runtime: "codex-cli",
    phase: "build",
    verificationState: "running",
    hostLabel: "ALFRED",
    repoName: "HappyTG",
    lastUpdatedAt: "2026-04-22T05:30:00.000Z",
    href: "/session/ses_visual",
    nextAction: "open"
  }
];

const projects = [
  {
    id: "ws_visual",
    hostId: "host_visual",
    hostLabel: "ALFRED",
    hostStatus: "active",
    repoName: "HappyTG",
    path: "C:/Develop/Projects/HappyTG",
    defaultBranch: "main",
    activeSessions: 1,
    href: "/project/ws_visual",
    newSessionHref: "/new-task?hostId=host_visual&workspaceId=ws_visual"
  }
];

const server = createMiniAppServer({
  async fetchJson(pathname, init) {
    if (pathname === "/health") {
      return { ok: true } as never;
    }
    if (pathname.startsWith("/api/v1/miniapp/dashboard")) {
      return {
        stats: {
          activeSessions: 1,
          pendingApprovals: 0,
          blockedSessions: 0,
          verifyProblems: 0
        },
        attention: [],
        recentSessions: sessions,
        recentReports: []
      } as never;
    }
    if (pathname.startsWith("/api/v1/miniapp/sessions") && init?.method !== "POST") {
      return { sessions } as never;
    }
    if (pathname.startsWith("/api/v1/miniapp/projects")) {
      return { projects } as never;
    }
    if (pathname.startsWith("/api/v1/miniapp/hosts")) {
      return {
        hosts: [
          {
            id: "host_visual",
            label: "ALFRED",
            status: "active",
            activeSessions: 1,
            repoNames: ["HappyTG"],
            href: "/host/host_visual"
          }
        ]
      } as never;
    }
    if (pathname.startsWith("/api/v1/miniapp/sessions") && init?.method === "POST") {
      return {
        session: {
          ...sessions[0],
          id: "ses_created",
          title: "Created from Mini App",
          href: "/session/ses_created"
        }
      } as never;
    }
    throw new Error(`Unexpected visual server path ${pathname}`);
  }
});

const port = Number(process.env.VISUAL_MINIAPP_PORT ?? 3097);
server.listen(port, "127.0.0.1", () => {
  console.log(`visual-miniapp listening http://127.0.0.1:${port}`);
});
