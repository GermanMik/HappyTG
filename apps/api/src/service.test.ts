import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileStateStore } from "../../../packages/shared/src/index.js";

import { HappyTGControlPlaneService } from "./service.js";

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

async function createServiceWithTempStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-test-"));
  const storePath = path.join(tempDir, "control-plane.json");
  return {
    tempDir,
    service: new HappyTGControlPlaneService(new FileStateStore(storePath))
  };
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
