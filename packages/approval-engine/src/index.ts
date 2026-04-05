import type { ApprovalDecision, ApprovalRequest, ActionKind } from "../../protocol/src/index.js";
import { createId, nowIso } from "../../shared/src/index.js";

export interface CreateApprovalInput {
  sessionId: string;
  actionKind: ActionKind;
  reason: string;
  risk: ApprovalRequest["risk"];
  ttlSeconds?: number;
}

export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequest {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 600) * 1000).toISOString();

  return {
    id: createId("apr"),
    sessionId: input.sessionId,
    actionKind: input.actionKind,
    state: "pending",
    risk: input.risk,
    reason: input.reason,
    expiresAt,
    createdAt,
    updatedAt: createdAt
  };
}

export function resolveApprovalRequest(
  request: ApprovalRequest,
  actorUserId: string,
  decision: "approved" | "rejected",
  reason?: string
): { approval: ApprovalRequest; auditDecision: ApprovalDecision } {
  const decidedAt = nowIso();
  return {
    approval: {
      ...request,
      state: decision,
      updatedAt: decidedAt
    },
    auditDecision: {
      id: createId("apd"),
      approvalRequestId: request.id,
      actorUserId,
      decision,
      reason,
      decidedAt
    }
  };
}

export function refreshExpiredApproval(request: ApprovalRequest, at = new Date()): ApprovalRequest {
  if (request.state !== "pending") {
    return request;
  }

  if (new Date(request.expiresAt).getTime() > at.getTime()) {
    return request;
  }

  return {
    ...request,
    state: "expired",
    updatedAt: at.toISOString()
  };
}
