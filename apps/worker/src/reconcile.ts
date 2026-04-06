import type {
  HappyTGStore,
  PendingDispatch,
  Session,
  SessionEvent
} from "../../../packages/protocol/src/index.js";
import { nowIso } from "../../../packages/shared/src/index.js";

export interface ReconcileConfig {
  staleAfterMs: number;
  orphanAfterMs: number;
}

export interface ReconcileResult {
  updatedHosts: number;
  updatedApprovals: number;
  sessionsMovedToReconnecting: number;
  sessionsFailed: number;
  dispatchesFailed: number;
}

function nextSequence(store: HappyTGStore, sessionId: string): number {
  const last = store.sessionEvents
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  return (last?.sequence ?? 0) + 1;
}

function appendEvent(store: HappyTGStore, sessionId: string, type: SessionEvent["type"], payload: SessionEvent["payload"], occurredAt: string): void {
  store.sessionEvents.push({
    id: `evt_reconcile_${store.sessionEvents.length + 1}`,
    sessionId,
    type,
    payload,
    occurredAt,
    sequence: nextSequence(store, sessionId)
  });
}

function findLatestDispatch(store: HappyTGStore, sessionId: string): PendingDispatch | undefined {
  return store.pendingDispatches
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .at(0);
}

function isActiveSessionState(state: Session["state"]): boolean {
  return state === "pending_dispatch" || state === "running" || state === "verifying";
}

export function reconcileSessionsAndDispatches(store: HappyTGStore, currentTimeMs: number, config: ReconcileConfig): ReconcileResult {
  const now = new Date(currentTimeMs);
  const timestamp = now.toISOString();
  const staleHostIds = new Set(
    store.hosts
      .filter((host) => host.lastSeenAt && currentTimeMs - new Date(host.lastSeenAt).getTime() > config.staleAfterMs)
      .map((host) => host.id)
  );

  let sessionsMovedToReconnecting = 0;
  let sessionsFailed = 0;
  let dispatchesFailed = 0;

  for (const session of store.sessions) {
    if (!staleHostIds.has(session.hostId) || !isActiveSessionState(session.state)) {
      continue;
    }

    const dispatch = findLatestDispatch(store, session.id);
    if (!dispatch || (dispatch.status !== "queued" && dispatch.status !== "running")) {
      continue;
    }

    const dispatchAgeMs = currentTimeMs - new Date(dispatch.updatedAt).getTime();
    if (dispatchAgeMs > config.orphanAfterMs) {
      dispatch.status = "failed";
      dispatch.updatedAt = timestamp;
      dispatchesFailed += 1;

      session.state = "failed";
      session.lastError = "Dispatch orphaned while host remained stale past reconciliation threshold.";
      session.currentSummary = "Dispatch failed after host disconnect exceeded reconciliation threshold.";
      session.updatedAt = timestamp;
      sessionsFailed += 1;

      appendEvent(store, session.id, "session.failed", {
        reason: session.lastError,
        dispatchId: dispatch.id,
        reconciliation: true
      }, timestamp);
      continue;
    }

    if (session.state !== "reconnecting") {
      session.state = "reconnecting";
      session.currentSummary = "Waiting for host reconnect to resume in-flight work.";
      session.updatedAt = timestamp;
      sessionsMovedToReconnecting += 1;
      appendEvent(store, session.id, "host.disconnected", {
        hostId: session.hostId,
        reconciliation: true
      }, timestamp);
    }
  }

  return {
    updatedHosts: 0,
    updatedApprovals: 0,
    sessionsMovedToReconnecting,
    sessionsFailed,
    dispatchesFailed
  };
}

export function cleanupDaemonLikeJournalEntries<T extends { state: string; lastUpdatedAt: string }>(
  entries: T[],
  currentTimeMs: number,
  completedRetentionMs: number
): T[] {
  return entries.filter((entry) => {
    if (entry.state !== "completed" && entry.state !== "failed") {
      return true;
    }

    return currentTimeMs - new Date(entry.lastUpdatedAt).getTime() <= completedRetentionMs;
  });
}

export function updateHostStatuses(store: HappyTGStore, currentTimeMs: number, staleAfterMs: number): number {
  let updatedHosts = 0;
  const timestamp = new Date(currentTimeMs).toISOString();
  for (const host of store.hosts) {
    if (!host.lastSeenAt) {
      continue;
    }

    const ageMs = currentTimeMs - new Date(host.lastSeenAt).getTime();
    const nextStatus = ageMs > staleAfterMs ? "stale" : host.pairedUserId ? "active" : host.status;
    if (host.status !== nextStatus) {
      host.status = nextStatus;
      host.updatedAt = timestamp;
      updatedHosts += 1;
    }
  }

  return updatedHosts;
}

export function markExpiredApprovalSessions(store: HappyTGStore, currentTimeMs: number): number {
  let updatedSessions = 0;
  const timestamp = new Date(currentTimeMs).toISOString();

  for (const approval of store.approvals) {
    if (approval.state !== "expired") {
      continue;
    }

    const session = store.sessions.find((item) => item.id === approval.sessionId);
    if (!session) {
      continue;
    }

    if (session.state !== "awaiting_approval") {
      continue;
    }

    session.state = "paused";
    session.lastError = "Approval expired before execution resumed.";
    session.currentSummary = "Execution paused because the pending approval expired.";
    session.updatedAt = timestamp;
    updatedSessions += 1;

    appendEvent(store, session.id, "approval.resolved", {
      approvalId: approval.id,
      decision: "expired"
    }, timestamp);
  }

  return updatedSessions;
}

export function summarizeReconcileResult(base: Omit<ReconcileResult, "updatedHosts" | "updatedApprovals"> & { updatedHosts: number; updatedApprovals: number; pausedSessions: number }): string | undefined {
  const changed = Object.entries(base).filter(([, value]) => value > 0);
  if (changed.length === 0) {
    return undefined;
  }

  return changed.map(([key, value]) => `${key}=${value}`).join(" ");
}

export function currentTimestamp(): string {
  return nowIso();
}
