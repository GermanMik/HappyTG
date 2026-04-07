import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyStore } from "../../../packages/protocol/src/index.js";

import { markExpiredApprovalSessions, reconcileSessionsAndDispatches, updateHostStatuses } from "./reconcile.js";

test("reconcileSessionsAndDispatches moves active sessions to reconnecting when host is stale", () => {
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
  assert.equal(store.sessions[0]?.state, "reconnecting");
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
    state: "awaiting_approval",
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
