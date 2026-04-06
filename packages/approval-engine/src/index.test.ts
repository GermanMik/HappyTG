import assert from "node:assert/strict";
import test from "node:test";

import { createApprovalRequest, refreshExpiredApproval, resolveApprovalRequest } from "./index.js";

test("createApprovalRequest creates pending approval with expiry", () => {
  const request = createApprovalRequest({
    sessionId: "ses_1",
    actionKind: "workspace_write",
    reason: "Need approval",
    risk: "high",
    ttlSeconds: 60
  });

  assert.equal(request.sessionId, "ses_1");
  assert.equal(request.state, "pending");
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
  assert.equal(resolved.approval.state, "approved");
  assert.equal(resolved.auditDecision.actorUserId, "usr_1");
  assert.equal(resolved.auditDecision.decision, "approved");
});

test("refreshExpiredApproval marks pending request as expired", () => {
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
