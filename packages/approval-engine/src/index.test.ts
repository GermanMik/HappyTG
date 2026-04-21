import assert from "node:assert/strict";
import test from "node:test";

import { createApprovalRequest, refreshExpiredApproval, resolveApprovalRequest, resolveApprovalRequestIdempotent } from "./index.js";

test("createApprovalRequest creates waiting human approval with expiry", () => {
  const request = createApprovalRequest({
    sessionId: "ses_1",
    actionKind: "workspace_write",
    reason: "Need approval",
    risk: "high",
    ttlSeconds: 60
  });

  assert.equal(request.sessionId, "ses_1");
  assert.equal(request.state, "waiting_human");
  assert.equal(request.scope, "once");
  assert.ok(request.nonce);
  assert.equal(request.risk, "high");
  assert.ok(new Date(request.expiresAt).getTime() > Date.now());
});

test("resolveApprovalRequest updates state and emits decision", () => {
  const request = createApprovalRequest({
    sessionId: "ses_1",
    actionKind: "workspace_write",
    reason: "Need approval",
    risk: "high"
  });

  const resolved = resolveApprovalRequest(request, "usr_1", "approved", "looks safe");
  assert.equal(resolved.approval.state, "approved_once");
  assert.equal(resolved.auditDecision.actorUserId, "usr_1");
  assert.equal(resolved.auditDecision.decision, "approved_once");
});

test("refreshExpiredApproval marks waiting human request as expired", () => {
  const request = createApprovalRequest({
    sessionId: "ses_1",
    actionKind: "workspace_write",
    reason: "Need approval",
    risk: "high",
    ttlSeconds: 1
  });

  const refreshed = refreshExpiredApproval(request, new Date(Date.now() + 5_000));
  assert.equal(refreshed.state, "expired");
});

test("resolveApprovalRequestIdempotent validates nonce and does not duplicate resolved decisions", () => {
  const request = createApprovalRequest({
    sessionId: "ses_1",
    actionKind: "workspace_write",
    reason: "Need approval",
    risk: "high"
  });

  assert.throws(
    () => resolveApprovalRequestIdempotent({
      request,
      actorUserId: "usr_1",
      decision: "approved",
      nonce: "stale"
    }),
    /nonce mismatch/i
  );

  const resolved = resolveApprovalRequestIdempotent({
    request,
    actorUserId: "usr_1",
    decision: "approved",
    scope: "session",
    nonce: request.nonce
  });

  assert.equal(resolved.changed, true);
  assert.equal(resolved.idempotent, false);
  assert.equal(resolved.approval.state, "approved_session");
  assert.ok(resolved.auditDecision);

  const replay = resolveApprovalRequestIdempotent({
    request: resolved.approval,
    actorUserId: "usr_1",
    decision: "approved",
    scope: "session",
    nonce: request.nonce
  });

  assert.equal(replay.changed, false);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.auditDecision, undefined);
  assert.equal(replay.approval.state, "approved_session");
});
