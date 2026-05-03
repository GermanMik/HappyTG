import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { HappyTGStore, TaskBundle } from "../../../packages/protocol/src/index.js";
import { CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE, CodexDesktopStateAdapter } from "../../../packages/runtime-adapters/src/index.js";
import { FileStateStore } from "../../../packages/shared/src/index.js";

import { CodexDesktopControlError, HappyTGControlPlaneService } from "./service.js";

function signedMiniAppInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secretKey).update(dataCheckString).digest("hex"));
  return params.toString();
}

async function createServiceWithTempStore(codexDesktop?: CodexDesktopStateAdapter) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-test-"));
  const storePath = path.join(tempDir, "control-plane.json");
  const store = new FileStateStore(storePath);
  return {
    tempDir,
    storePath,
    store,
    service: new HappyTGControlPlaneService(store, undefined, codexDesktop)
  };
}

async function createKnownUser(service: HappyTGControlPlaneService, suffix: string): Promise<string> {
  const pairing = await service.startPairing({
    hostLabel: `desktop-host-${suffix}`,
    fingerprint: `fp-desktop-${suffix}`
  });
  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: `99${suffix}`,
    chatId: `99${suffix}`,
    displayName: `Desktop User ${suffix}`
  });
  return claim.user.id;
}

async function createCodexDesktopHome(root: string): Promise<string> {
  const codexHome = path.join(root, ".codex-fixture");
  const sessionDir = path.join(codexHome, "sessions", "2026", "04", "28");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(codexHome, ".codex-global-state.json"),
    JSON.stringify({
      "electron-saved-workspace-roots": ["C:/Develop/Projects/HappyTG"],
      "thread-workspace-root-hints": {
        "desktop-session-1": "C:/Develop/Projects/HappyTG"
      }
    }),
    "utf8"
  );
  await writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: "desktop-session-1", thread_name: "Desktop fixture", updated_at: "2026-04-28T08:00:00.000Z" })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(sessionDir, "desktop-session-1.jsonl"),
    [
      JSON.stringify({ timestamp: "2026-04-28T09:00:00.000Z", payload: { id: "desktop-session-1", cwd: "C:/Develop/Projects/HappyTG", role: "user", content: "RAW_SECRET_PROMPT" } }),
      JSON.stringify({ timestamp: "2026-04-28T09:01:00.000Z", payload: { id: "desktop-session-1", role: "assistant", content: "Safe Desktop summary" } })
    ].join("\n") + "\n",
    "utf8"
  );
  return codexHome;
}

test("proof session creates task bundle and approval, then approval dispatches session", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "test-host",
    fingerprint: "fp-1"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1001",
    chatId: "2001",
    displayName: "Test User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-1",
    capabilities: ["codex-cli"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const sessionResult = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "proof",
    runtime: "codex-cli",
    title: "proof",
    prompt: "proof prompt",
    acceptanceCriteria: ["criterion"]
  });

  assert.equal(sessionResult.session.state, "needs_approval");
  assert.ok(sessionResult.approval);
  assert.ok(sessionResult.task);

  const resolved = await service.resolveApproval(sessionResult.approval!.id, {
    userId: claim.user.id,
    decision: "approved",
    scope: "phase",
    nonce: sessionResult.approval!.nonce
  });

  assert.equal(resolved.session.state, "ready");
  assert.equal(resolved.approval.state, "approved_phase");
  assert.ok(resolved.dispatch);
});

test("quick session dispatches immediately without approval", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "test-host",
    fingerprint: "fp-2"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1002",
    chatId: "2002",
    displayName: "Test User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-2",
    capabilities: ["codex-cli"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const sessionResult = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "quick",
    runtime: "codex-cli",
    title: "quick",
    prompt: "read only"
  });

  assert.equal(sessionResult.session.state, "ready");
  assert.ok(sessionResult.dispatch);
  assert.equal(sessionResult.approval, undefined);
});

test("cancelSession cancels active sessions, dispatch records, event, and audit", async () => {
  const { tempDir, storePath, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  try {
    const pairing = await service.startPairing({
      hostLabel: "cancel-host",
      fingerprint: "fp-cancel"
    });
    const claim = await service.claimPairing({
      pairingCode: pairing.pairingCode,
      telegramUserId: "1012",
      chatId: "2012",
      displayName: "Cancel User"
    });
    const hello = await service.hostHello({
      hostId: pairing.hostId,
      fingerprint: "fp-cancel",
      capabilities: ["codex-cli"],
      workspaces: [
        {
          path: workspaceDir,
          repoName: "workspace"
        }
      ]
    });
    const created = await service.createSession({
      userId: claim.user.id,
      hostId: pairing.hostId,
      workspaceId: hello.workspaces[0]!.id,
      mode: "quick",
      runtime: "codex-cli",
      title: "cancel me",
      prompt: "read status"
    });

    assert.equal((await service.hostPoll({ hostId: pairing.hostId })).dispatches.length, 1);

    const cancelled = await service.cancelSession(created.session.id);
    const timeline = await service.getSessionTimeline(created.session.id);
    const store = JSON.parse(await readFile(storePath, "utf8")) as HappyTGStore;

    assert.equal(cancelled.state, "cancelled");
    assert.equal((await service.hostPoll({ hostId: pairing.hostId })).dispatches.length, 0);
    assert.equal(store.pendingDispatches.find((item) => item.sessionId === created.session.id)?.status, "cancelled");
    assert.equal(timeline.events.at(-1)?.type, "SessionCancelled");
    assert.equal(store.auditRecords.some((item) => item.action === "session.cancelled" && item.targetRef === created.session.id), true);

    const eventCount = timeline.events.length;
    const replay = await service.cancelSession(created.session.id);
    const replayTimeline = await service.getSessionTimeline(created.session.id);

    assert.equal(replay.state, "cancelled");
    assert.equal(replayTimeline.events.length, eventCount);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("session timeline and task artifact reads are available for mini app inspection", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "test-host",
    fingerprint: "fp-3"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1003",
    chatId: "2003",
    displayName: "Test User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-3",
    capabilities: ["codex-cli"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const created = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "proof",
    runtime: "codex-cli",
    title: "proof",
    prompt: "proof prompt",
    acceptanceCriteria: ["criterion"]
  });

  const timeline = await service.getSessionTimeline(created.session.id);
  assert.equal(timeline.events.length >= 3, true);
  assert.equal(timeline.task?.id, created.task?.id);

  const spec = await service.readTaskArtifact(created.task!.id, "spec.md");
  assert.match(spec.content, /# Task Spec/);

  await assert.rejects(() => service.readTaskArtifact(created.task!.id, "../escape.txt"), /escapes task bundle root/i);
});

test("bootstrap sessions dispatch deterministic doctor runs and support resume state transitions", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "doctor-host",
    fingerprint: "fp-4"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1004",
    chatId: "2004",
    displayName: "Doctor User"
  });

  await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-4",
    capabilities: ["codex-cli", "resume"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const diagnostic = await service.createBootstrapSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    command: "doctor"
  });

  assert.equal(diagnostic.session.state, "ready");
  assert.equal(diagnostic.dispatch?.executionKind, "bootstrap_doctor");
  assert.equal(diagnostic.dispatch?.actionKind, "read_status");

  const resumed = await service.resumeSession(diagnostic.session.id);
  assert.equal(resumed.state, "resuming");
});

test("bot projections list user-scoped workspaces, sessions, approvals, and reject stale callback nonce", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "projection-host",
    fingerprint: "fp-5"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1005",
    chatId: "2005",
    displayName: "Projection User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-5",
    capabilities: ["codex-cli", "proof-loop"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "projection-repo",
        defaultBranch: "main"
      }
    ]
  });

  const workspaces = await service.listWorkspaces(pairing.hostId, claim.user.id);
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0]?.repoName, "projection-repo");

  const created = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "proof",
    runtime: "codex-cli",
    title: "projection proof",
    prompt: "projection prompt",
    acceptanceCriteria: ["criterion"]
  });

  const sessions = await service.listSessions(claim.user.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.id, created.session.id);

  const approvals = await service.listApprovals(claim.user.id, ["waiting_human"]);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.id, created.approval?.id);

  await assert.rejects(
    () => service.resolveApproval(created.approval!.id, {
      userId: claim.user.id,
      decision: "approved",
      scope: "session",
      nonce: "stale-callback"
    }),
    /nonce mismatch/i
  );

  const resolved = await service.resolveApproval(created.approval!.id, {
    userId: claim.user.id,
    decision: "approved",
    scope: "session",
    nonce: created.approval!.nonce
  });

  assert.equal(resolved.approval.state, "approved_session");

  const replay = await service.resolveApproval(created.approval!.id, {
    userId: claim.user.id,
    decision: "approved",
    scope: "session",
    nonce: created.approval!.nonce
  });

  assert.equal(replay.approval.state, "approved_session");
  assert.equal(replay.dispatch, undefined);
});

test("Codex Desktop projections are user-scoped and sanitized", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-desktop-projection-"));
  let serviceTempDir: string | undefined;
  try {
    const codexHome = await createCodexDesktopHome(tempDir);
    const bundle = await createServiceWithTempStore(new CodexDesktopStateAdapter({ codexHome }));
    serviceTempDir = bundle.tempDir;
    const { store, service } = bundle;
    const userId = await createKnownUser(service, "01");

    const projects = await service.listCodexDesktopProjects(userId);
    const sessions = await service.listCodexDesktopSessions(userId);
    const detail = await service.getCodexDesktopSessionDetail(userId, "desktop-session-1");

    assert.equal(projects.projects[0]?.source, "codex-desktop");
    assert.equal(projects.projects[0]?.label, "HappyTG");
    assert.equal(sessions.sessions[0]?.source, "codex-desktop");
    assert.equal(sessions.sessions[0]?.canResume, false);
    assert.equal(sessions.sessions[0]?.canStop, false);
    assert.equal(detail.session.source, "codex-desktop");
    assert.equal(detail.history[0]?.source, "codex-desktop");
    assert.match(detail.history[1]?.summary ?? "", /Safe Desktop summary/);
    assert.doesNotMatch(JSON.stringify({ projects, sessions, detail }), /RAW_SECRET_PROMPT/);
    await assert.rejects(() => service.listCodexDesktopSessions("unknown-user"), /User not found/);
    await assert.rejects(() => service.getCodexDesktopSessionDetail(userId, "missing-session"), /Codex Desktop session not found/);

    const storeState = await store.read();
    assert.equal(storeState.users.some((user) => user.id === userId), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (serviceTempDir) {
      await rm(serviceTempDir, { recursive: true, force: true });
    }
  }
});

test("Codex Desktop controls block unavailable contracts and audit attempts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-desktop-unsupported-"));
  let serviceTempDir: string | undefined;
  try {
    const codexHome = await createCodexDesktopHome(tempDir);
    const bundle = await createServiceWithTempStore(new CodexDesktopStateAdapter({ codexHome }));
    serviceTempDir = bundle.tempDir;
    const { store, service } = bundle;
    const userId = await createKnownUser(service, "02");

    await assert.rejects(
      () => service.resumeCodexDesktopSession(userId, "desktop-session-1"),
      (error) => error instanceof CodexDesktopControlError && error.statusCode === 501 && error.reasonCode === CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE
    );
    await assert.rejects(
      () => service.stopCodexDesktopSession(userId, "desktop-session-1"),
      (error) => error instanceof CodexDesktopControlError && error.statusCode === 501 && error.reasonCode === CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE
    );
    await assert.rejects(
      () => service.createCodexDesktopTask({ userId, prompt: "Do desktop work", projectPath: "C:/Develop/Projects/HappyTG" }),
      (error) => error instanceof CodexDesktopControlError && error.statusCode === 501 && error.reasonCode === CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE
    );

    const auditRecords = (await store.read()).auditRecords;
    const actions = auditRecords.map((record) => record.action);
    assert.equal(actions.includes("codex_desktop.resume.attempt"), true);
    assert.equal(actions.includes("codex_desktop.resume.unsupported"), true);
    assert.equal(actions.includes("codex_desktop.stop.attempt"), true);
    assert.equal(actions.includes("codex_desktop.stop.unsupported"), true);
    assert.equal(actions.includes("codex_desktop.new_task.attempt"), true);
    assert.equal(actions.includes("codex_desktop.new_task.unsupported"), true);
    assert.equal(auditRecords.some((record) => record.action.endsWith(".unsupported") && record.metadata.reasonCode === CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (serviceTempDir) {
      await rm(serviceTempDir, { recursive: true, force: true });
    }
  }
});

test("Codex Desktop controls execute only through supported adapter contract", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-desktop-supported-"));
  let serviceTempDir: string | undefined;
  try {
    const codexHome = await createCodexDesktopHome(tempDir);
    const calls: string[] = [];
    const adapter = new CodexDesktopStateAdapter({
      codexHome,
      controlContract: {
        supportsResume: true,
        supportsStop: true,
        supportsNewTask: true,
        async resumeSession(session) {
          calls.push(`resume:${session.id}`);
          return { ok: true, action: "resume", source: "codex-desktop", session };
        },
        async stopSession(session) {
          calls.push(`stop:${session.id}`);
          return { ok: true, action: "stop", source: "codex-desktop", session };
        },
        async createTask(input) {
          calls.push(`new-task:${input.projectPath ?? input.projectId}`);
          return {
            ok: true,
            action: "new-task",
            source: "codex-desktop",
            task: {
              id: "cdt_supported",
              title: input.title ?? "Desktop task",
              projectPath: input.projectPath,
              status: "created"
            }
          };
        }
      }
    });
    const bundle = await createServiceWithTempStore(adapter);
    serviceTempDir = bundle.tempDir;
    const { store, service } = bundle;
    const userId = await createKnownUser(service, "03");

    const resume = await service.resumeCodexDesktopSession(userId, "desktop-session-1");
    const stop = await service.stopCodexDesktopSession(userId, "desktop-session-1");
    const created = await service.createCodexDesktopTask({ userId, prompt: "Do desktop work", projectPath: "C:/Develop/Projects/HappyTG" });

    assert.equal(resume.action, "resume");
    assert.equal(stop.action, "stop");
    assert.equal(created.task?.id, "cdt_supported");
    assert.deepEqual(calls, [
      "resume:desktop-session-1",
      "stop:desktop-session-1",
      "new-task:C:/Develop/Projects/HappyTG"
    ]);

    const actions = (await store.read()).auditRecords.map((record) => record.action);
    assert.equal(actions.includes("codex_desktop.resume.completed"), true);
    assert.equal(actions.includes("codex_desktop.stop.completed"), true);
    assert.equal(actions.includes("codex_desktop.new_task.completed"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (serviceTempDir) {
      await rm(serviceTempDir, { recursive: true, force: true });
    }
  }
});

test("Codex Desktop mutating controls are serialized through the API service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-desktop-serialized-"));
  let serviceTempDir: string | undefined;
  try {
    const codexHome = await createCodexDesktopHome(tempDir);
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const recordMutation = async (label: string): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${label}`);
      active -= 1;
    };
    const adapter = new CodexDesktopStateAdapter({
      codexHome,
      controlContract: {
        supportsResume: true,
        supportsStop: true,
        supportsNewTask: true,
        async resumeSession(session) {
          await recordMutation("resume");
          return { ok: true, action: "resume", source: "codex-desktop", session };
        },
        async stopSession(session) {
          await recordMutation("stop");
          return { ok: true, action: "stop", source: "codex-desktop", session };
        },
        async createTask(input) {
          await recordMutation("new-task");
          return {
            ok: true,
            action: "new-task",
            source: "codex-desktop",
            task: {
              id: "cdt_serialized",
              title: input.title ?? "Desktop task",
              projectPath: input.projectPath,
              status: "created"
            }
          };
        }
      }
    });
    const bundle = await createServiceWithTempStore(adapter);
    serviceTempDir = bundle.tempDir;
    const { service } = bundle;
    const userId = await createKnownUser(service, "04");

    await Promise.all([
      service.resumeCodexDesktopSession(userId, "desktop-session-1"),
      service.stopCodexDesktopSession(userId, "desktop-session-1"),
      service.createCodexDesktopTask({ userId, prompt: "Do desktop work", projectPath: "C:/Develop/Projects/HappyTG" })
    ]);

    assert.equal(maxActive, 1);
    assert.equal(order.length, 6);
    assert.equal(order.filter((item) => item.startsWith("start:")).length, 3);
    assert.equal(order.filter((item) => item.startsWith("end:")).length, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (serviceTempDir) {
      await rm(serviceTempDir, { recursive: true, force: true });
    }
  }
});

test("mini app launch validates initData, issues app session, and exposes action-first projections", async () => {
  const previousBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousSecret = process.env.HAPPYTG_MINIAPP_LAUNCH_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = "123456:abcdefghijklmnopqrstuvwx";
  process.env.HAPPYTG_MINIAPP_LAUNCH_SECRET = "test-miniapp-secret";

  try {
    const { tempDir, service } = await createServiceWithTempStore();
    const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

    const pairing = await service.startPairing({
      hostLabel: "miniapp-host",
      fingerprint: "fp-miniapp"
    });

    const claim = await service.claimPairing({
      pairingCode: pairing.pairingCode,
      telegramUserId: "9001",
      chatId: "9001",
      displayName: "Mini User"
    });

    const hello = await service.hostHello({
      hostId: pairing.hostId,
      fingerprint: "fp-miniapp",
      capabilities: ["codex-cli"],
      workspaces: [
        {
          path: workspaceDir,
          repoName: "miniapp-repo"
        }
      ]
    });

    const session = await service.createSession({
      userId: claim.user.id,
      hostId: pairing.hostId,
      workspaceId: hello.workspaces[0]!.id,
      mode: "proof",
      runtime: "codex-cli",
      title: "Mini App proof",
      prompt: "Inspect Mini App",
      acceptanceCriteria: ["renders dashboard"]
    });

    const grant = await service.createMiniAppLaunchGrant({
      userId: claim.user.id,
      kind: "session",
      targetId: session.session.id,
      maxUses: 2
    });

    const initData = signedMiniAppInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      start_param: grant.startAppPayload,
      user: JSON.stringify({ id: 9001, first_name: "Mini" })
    }, process.env.TELEGRAM_BOT_TOKEN);

    const appSession = await service.createMiniAppSession({
      initData
    });

    assert.equal(appSession.user.id, claim.user.id);
    assert.equal(appSession.launch?.kind, "session");
    assert.ok(appSession.appSession.token.startsWith("mas_"));

    const authenticated = await service.authenticateMiniAppSession(appSession.appSession.token);
    assert.equal(authenticated?.id, claim.user.id);

    const revokedSession = await service.revokeMiniAppSession(appSession.appSession.id, claim.user.id);
    assert.ok(revokedSession.revokedAt);
    assert.equal(await service.authenticateMiniAppSession(appSession.appSession.token), undefined);

    const revokedGrant = await service.revokeMiniAppLaunchGrant(grant.grant.id, claim.user.id);
    assert.ok(revokedGrant.revokedAt);

    const anonymousDashboard = await service.getMiniAppDashboard();
    assert.equal(anonymousDashboard.stats.pendingApprovals, 0);
    assert.equal(anonymousDashboard.attention.length, 0);
    const anonymousOverview = await service.getMiniAppOverview();
    assert.equal(anonymousOverview.sessions.length, 0);
    assert.equal(anonymousOverview.approvals.length, 0);

    const dashboard = await service.getMiniAppDashboard(claim.user.id);
    assert.equal(dashboard.stats.pendingApprovals, 1);
    assert.equal(dashboard.attention[0]?.kind, "approval");

    const sessions = await service.listMiniAppSessions(claim.user.id);
    assert.equal(sessions.sessions[0]?.repoName, "miniapp-repo");

    const verify = await service.getMiniAppVerifySummary(session.session.id, claim.user.id);
    assert.equal(verify.state, "not_started");
    assert.equal(verify.nextAction, "open_evidence");
  } finally {
    if (previousBotToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
    }
    if (previousSecret === undefined) {
      delete process.env.HAPPYTG_MINIAPP_LAUNCH_SECRET;
    } else {
      process.env.HAPPYTG_MINIAPP_LAUNCH_SECRET = previousSecret;
    }
  }
});

test("proof task filesystem initialization runs outside the serialized store queue", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-proof-queue-"));
  let releaseInit!: () => void;
  let initStarted!: () => void;
  const initStartedPromise = new Promise<void>((resolve) => {
    initStarted = resolve;
  });
  const releaseInitPromise = new Promise<void>((resolve) => {
    releaseInit = resolve;
  });
  const service = new HappyTGControlPlaneService(
    new FileStateStore(path.join(tempDir, "control-plane.json")),
    {
      async initTaskBundle(input) {
        initStarted();
        await releaseInitPromise;
        const now = "2026-04-27T12:00:00.000Z";
        return {
          id: input.taskId,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          rootPath: path.join(input.repoRoot, ".agent", "tasks", input.taskId),
          phase: "freeze",
          mode: "proof",
          title: input.title,
          acceptanceCriteria: input.acceptanceCriteria,
          verificationState: "not_started",
          createdAt: now,
          updatedAt: now
        } satisfies TaskBundle;
      },
      async recordTaskApproval(task) {
        return task;
      },
      async advanceTaskPhase(task, phase, _event, verificationState) {
        return {
          ...task,
          phase,
          verificationState: verificationState ?? task.verificationState,
          updatedAt: "2026-04-27T12:00:01.000Z"
        };
      }
    }
  );
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  try {
    const pairing = await service.startPairing({
      hostLabel: "proof-host",
      fingerprint: "fp-proof-queue"
    });
    const claim = await service.claimPairing({
      pairingCode: pairing.pairingCode,
      telegramUserId: "777",
      chatId: "777",
      displayName: "Queue User"
    });
    const hello = await service.hostHello({
      hostId: pairing.hostId,
      fingerprint: "fp-proof-queue",
      capabilities: ["codex-cli"],
      workspaces: [
        {
          path: workspaceDir,
          repoName: "queue-repo"
        }
      ]
    });

    const proofSession = service.createSession({
      userId: claim.user.id,
      hostId: pairing.hostId,
      workspaceId: hello.workspaces[0]!.id,
      mode: "proof",
      runtime: "codex-cli",
      title: "queue proof",
      prompt: "prove queue is free",
      acceptanceCriteria: ["store queue remains free"]
    });
    await initStartedPromise;

    const unrelatedMutation = service.startPairing({
      hostLabel: "other-host",
      fingerprint: "fp-unblocked"
    });
    const completedWhileInitWasPending = await Promise.race([
      unrelatedMutation.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))
    ]);

    assert.equal(completedWhileInitWasPending, true);
    releaseInit();

    const result = await proofSession;
    assert.equal(result.session.state, "needs_approval");
    assert.ok(result.task);
    assert.ok(result.approval);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("proof approval record failure fails session and closes the waiting approval", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-proof-approval-failure-"));
  const service = new HappyTGControlPlaneService(
    new FileStateStore(path.join(tempDir, "control-plane.json")),
    {
      async initTaskBundle(input) {
        const now = "2026-04-27T12:00:00.000Z";
        return {
          id: input.taskId,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          rootPath: path.join(input.repoRoot, ".agent", "tasks", input.taskId),
          phase: "freeze",
          mode: "proof",
          title: input.title,
          acceptanceCriteria: input.acceptanceCriteria,
          verificationState: "not_started",
          createdAt: now,
          updatedAt: now
        } satisfies TaskBundle;
      },
      async recordTaskApproval() {
        throw new Error("repo-proof write failed");
      },
      async advanceTaskPhase(task, phase, _event, verificationState) {
        return {
          ...task,
          phase,
          verificationState: verificationState ?? task.verificationState,
          updatedAt: "2026-04-27T12:00:01.000Z"
        };
      }
    }
  );
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  try {
    const pairing = await service.startPairing({
      hostLabel: "proof-host",
      fingerprint: "fp-proof-approval-failure"
    });
    const claim = await service.claimPairing({
      pairingCode: pairing.pairingCode,
      telegramUserId: "778",
      chatId: "778",
      displayName: "Approval Failure User"
    });
    const hello = await service.hostHello({
      hostId: pairing.hostId,
      fingerprint: "fp-proof-approval-failure",
      capabilities: ["codex-cli"],
      workspaces: [
        {
          path: workspaceDir,
          repoName: "approval-failure-repo"
        }
      ]
    });

    await assert.rejects(
      () => service.createSession({
        userId: claim.user.id,
        hostId: pairing.hostId,
        workspaceId: hello.workspaces[0]!.id,
        mode: "proof",
        runtime: "codex-cli",
        title: "approval record failure",
        prompt: "fail approval record",
        acceptanceCriteria: ["approval is closed"]
      }),
      /repo-proof write failed/
    );

    const sessions = await service.listSessions(claim.user.id);
    const failed = sessions.find((item) => item.title === "approval record failure");
    assert.equal(failed?.state, "failed");
    const approvals = await service.listApprovals(claim.user.id);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]?.state, "superseded");
    const replay = await service.resolveApproval(approvals[0]!.id, {
      userId: claim.user.id,
      decision: "approved",
      nonce: approvals[0]!.nonce
    });
    assert.equal(replay.approval.state, "superseded");
    assert.equal(replay.session.state, "failed");
    assert.equal(replay.dispatch, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
