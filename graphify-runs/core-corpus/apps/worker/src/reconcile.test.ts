import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyStore } from "../../../packages/protocol/src/index.js";

import { compactControlPlaneRecords, markExpiredApprovalSessions, reconcileSessionsAndDispatches, updateHostStatuses } from "./reconcile.js";

test("reconcileSessionsAndDispatches moves active sessions to resuming when host is stale", () => {
  const now = Date.now();
  const store = createEmptyStore();
  store.hosts.push({
    id: "host_1",
    label: "host",
    fingerprint: "fp",
    status: "active",
    capabilities: [],
    lastSeenAt: new Date(now - 60_000).toISOString(),
    pairedUserId: "usr_1",
    runtimePreference: "codex-cli",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  store.sessions.push({
    id: "ses_1",
    userId: "usr_1",
    hostId: "host_1",
    workspaceId: "ws_1",
    mode: "quick",
    runtime: "codex-cli",
    state: "running",
    title: "test",
    prompt: "test",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  store.pendingDispatches.push({
    id: "dsp_1",
    sessionId: "ses_1",
    hostId: "host_1",
    workspaceId: "ws_1",
    executionKind: "runtime_session",
    mode: "quick",
    runtime: "codex-cli",
    actionKind: "workspace_read",
    prompt: "test",
    title: "test",
    status: "running",
    idempotencyKey: "idem",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now - 10_000).toISOString()
  });

  const updatedHosts = updateHostStatuses(store, now, 20_000);
  const result = reconcileSessionsAndDispatches(store, now, {
    staleAfterMs: 20_000,
    orphanAfterMs: 120_000
  });

  assert.equal(updatedHosts, 1);
  assert.equal(result.sessionsMovedToReconnecting, 1);
  assert.equal(store.sessions[0]?.state, "resuming");
});

test("markExpiredApprovalSessions pauses awaiting approval sessions", () => {
  const now = Date.now();
  const store = createEmptyStore();
  store.sessions.push({
    id: "ses_1",
    userId: "usr_1",
    hostId: "host_1",
    workspaceId: "ws_1",
    mode: "proof",
    runtime: "codex-cli",
    state: "needs_approval",
    title: "test",
    prompt: "test",
    approvalId: "apr_1",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  store.approvals.push({
    id: "apr_1",
    sessionId: "ses_1",
    actionKind: "workspace_write",
    state: "expired",
    risk: "high",
    reason: "expired",
    expiresAt: new Date(now - 1_000).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });

  const changed = markExpiredApprovalSessions(store, now);
  assert.equal(changed, 1);
  assert.equal(store.sessions[0]?.state, "paused");
});

test("compactControlPlaneRecords removes expired terminal records while preserving active records", () => {
  const now = Date.parse("2026-04-27T12:00:00.000Z");
  const old = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 60_000).toISOString();
  const future = new Date(now + 60_000).toISOString();
  const store = createEmptyStore();

  store.miniAppLaunchGrants.push(
    {
      id: "grant_expired",
      kind: "session",
      payload: "expired",
      nonce: "nonce_expired",
      expiresAt: old,
      maxUses: 1,
      uses: 0,
      createdAt: old,
      updatedAt: old
    },
    {
      id: "grant_active",
      kind: "session",
      payload: "active",
      nonce: "nonce_active",
      expiresAt: future,
      maxUses: 1,
      uses: 0,
      createdAt: recent,
      updatedAt: recent
    }
  );
  store.miniAppSessions.push(
    {
      id: "mas_revoked",
      userId: "usr_1",
      telegramUserId: "42",
      tokenHash: "revoked",
      expiresAt: future,
      revokedAt: recent,
      createdAt: old,
      lastSeenAt: recent
    },
    {
      id: "mas_active",
      userId: "usr_1",
      telegramUserId: "42",
      tokenHash: "active",
      expiresAt: future,
      createdAt: recent,
      lastSeenAt: recent
    }
  );
  store.hostRegistrations.push(
    {
      id: "reg_old",
      hostId: "host_1",
      pairingCode: "OLD",
      expiresAt: old,
      status: "expired",
      createdAt: old
    },
    {
      id: "reg_active",
      hostId: "host_1",
      pairingCode: "NEW",
      expiresAt: future,
      status: "issued",
      createdAt: recent
    }
  );
  store.sessions.push(
    {
      id: "ses_done",
      userId: "usr_1",
      hostId: "host_1",
      workspaceId: "ws_1",
      mode: "proof",
      runtime: "codex-cli",
      state: "completed",
      title: "done",
      prompt: "done",
      createdAt: old,
      updatedAt: old
    },
    {
      id: "ses_active",
      userId: "usr_1",
      hostId: "host_1",
      workspaceId: "ws_1",
      mode: "proof",
      runtime: "codex-cli",
      state: "running",
      title: "active",
      prompt: "active",
      createdAt: recent,
      updatedAt: recent
    }
  );
  store.approvals.push(
    {
      id: "apr_old",
      sessionId: "ses_done",
      actionKind: "workspace_write",
      state: "denied",
      risk: "high",
      reason: "old",
      expiresAt: old,
      createdAt: old,
      updatedAt: old
    },
    {
      id: "apr_active_session",
      sessionId: "ses_active",
      actionKind: "workspace_write",
      state: "approved_once",
      risk: "high",
      reason: "active session",
      expiresAt: old,
      createdAt: old,
      updatedAt: old
    },
    {
      id: "apr_waiting",
      sessionId: "ses_done",
      actionKind: "workspace_write",
      state: "waiting_human",
      risk: "high",
      reason: "waiting",
      expiresAt: old,
      createdAt: old,
      updatedAt: old
    }
  );
  store.pendingDispatches.push(
    {
      id: "dsp_old",
      sessionId: "ses_done",
      hostId: "host_1",
      workspaceId: "ws_1",
      executionKind: "runtime_session",
      mode: "proof",
      runtime: "codex-cli",
      actionKind: "workspace_write",
      prompt: "done",
      title: "done",
      status: "completed",
      idempotencyKey: "old",
      createdAt: old,
      updatedAt: old
    },
    {
      id: "dsp_active_session",
      sessionId: "ses_active",
      hostId: "host_1",
      workspaceId: "ws_1",
      executionKind: "runtime_session",
      mode: "proof",
      runtime: "codex-cli",
      actionKind: "workspace_write",
      prompt: "active",
      title: "active",
      status: "completed",
      idempotencyKey: "active",
      createdAt: old,
      updatedAt: old
    },
    {
      id: "dsp_running",
      sessionId: "ses_done",
      hostId: "host_1",
      workspaceId: "ws_1",
      executionKind: "runtime_session",
      mode: "proof",
      runtime: "codex-cli",
      actionKind: "workspace_write",
      prompt: "running",
      title: "running",
      status: "running",
      idempotencyKey: "running",
      createdAt: old,
      updatedAt: old
    }
  );

  const result = compactControlPlaneRecords(store, now, {
    terminalRecordRetentionMs: 7 * 24 * 60 * 60 * 1000,
    hostRegistrationRetentionMs: 24 * 60 * 60 * 1000
  });

  assert.deepEqual(result, {
    miniAppLaunchGrantsRemoved: 1,
    miniAppSessionsRemoved: 1,
    hostRegistrationsRemoved: 1,
    approvalsRemoved: 1,
    dispatchesRemoved: 1
  });
  assert.deepEqual(store.miniAppLaunchGrants.map((item) => item.id), ["grant_active"]);
  assert.deepEqual(store.miniAppSessions.map((item) => item.id), ["mas_active"]);
  assert.deepEqual(store.hostRegistrations.map((item) => item.id), ["reg_active"]);
  assert.deepEqual(store.approvals.map((item) => item.id).sort(), ["apr_active_session", "apr_waiting"]);
  assert.deepEqual(store.pendingDispatches.map((item) => item.id).sort(), ["dsp_active_session", "dsp_running"]);
});
