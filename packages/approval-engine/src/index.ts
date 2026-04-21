import type { ApprovalDecision, ApprovalRequest, ActionKind, ApprovalScope, ApprovalState } from "../../protocol/src/index.js";
import { createId, nowIso } from "../../shared/src/index.js";

export interface CreateApprovalInput {
  sessionId: string;
  actionKind: ActionKind;
  reason: string;
  risk: ApprovalRequest["risk"];
  scope?: ApprovalScope;
  ttlSeconds?: number;
}

export interface ResolveApprovalInput {
  request: ApprovalRequest;
  actorUserId: string;
  decision: "approved" | "rejected";
  reason?: string;
  scope?: ApprovalScope;
  nonce?: string;
}

export interface ResolveApprovalResult {
  approval: ApprovalRequest;
  auditDecision?: ApprovalDecision;
  changed: boolean;
  idempotent: boolean;
}

const RESOLVABLE_APPROVAL_STATES: readonly ApprovalState[] = ["pending", "waiting_human"] as const;
const RESOLVED_APPROVAL_STATES: readonly ApprovalState[] = [
  "approved_once",
  "approved_phase",
  "approved_session",
  "denied",
  "expired",
  "superseded",
  "auto_allowed",
  "auto_denied",
  "not_required"
] as const;

export function isApprovalWaitingForHuman(request: ApprovalRequest): boolean {
  return RESOLVABLE_APPROVAL_STATES.includes(request.state);
}

export function isApprovalResolved(request: ApprovalRequest): boolean {
  return RESOLVED_APPROVAL_STATES.includes(request.state);
}

export function assertApprovalNonce(request: ApprovalRequest, nonce?: string): void {
  if (request.nonce && nonce && request.nonce !== nonce) {
    throw new Error("Approval callback nonce mismatch");
  }
}

export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequest {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 600) * 1000).toISOString();

  return {
    id: createId("apr"),
    sessionId: input.sessionId,
    actionKind: input.actionKind,
    state: "waiting_human",
    scope: input.scope ?? "once",
    nonce: createId("apn"),
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
  reason?: string,
  scope: ApprovalScope = request.scope ?? "once"
): { approval: ApprovalRequest; auditDecision: ApprovalDecision } {
  const decidedAt = nowIso();
  const resolvedState: ApprovalState = decision === "approved"
    ? scope === "phase"
      ? "approved_phase"
      : scope === "session"
        ? "approved_session"
        : "approved_once"
    : "denied";
  return {
    approval: {
      ...request,
      state: resolvedState,
      updatedAt: decidedAt
    },
    auditDecision: {
      id: createId("apd"),
      approvalRequestId: request.id,
      actorUserId,
      decision: resolvedState,
      reason,
      decidedAt
    }
  };
}

export function resolveApprovalRequestIdempotent(input: ResolveApprovalInput): ResolveApprovalResult {
  assertApprovalNonce(input.request, input.nonce);

  if (isApprovalResolved(input.request)) {
    return {
      approval: input.request,
      changed: false,
      idempotent: true
    };
  }

  if (!isApprovalWaitingForHuman(input.request)) {
    throw new Error(`Approval is not waiting for a human decision: ${input.request.state}`);
  }

  const resolved = resolveApprovalRequest(input.request, input.actorUserId, input.decision, input.reason, input.scope);
  return {
    approval: resolved.approval,
    auditDecision: resolved.auditDecision,
    changed: true,
    idempotent: false
  };
}

export function refreshExpiredApproval(request: ApprovalRequest, at = new Date()): ApprovalRequest {
  if (request.state !== "pending" && request.state !== "waiting_human") {
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
