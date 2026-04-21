import type { EventName, Session, SessionEvent, SessionState } from "../../protocol/src/index.js";
import { nowIso } from "../../shared/src/index.js";

export const TERMINAL_SESSION_STATES: readonly SessionState[] = ["completed", "failed", "cancelled"] as const;

export const VALID_SESSION_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  created: ["preparing", "cancelled", "failed"],
  preparing: ["ready", "running", "blocked", "needs_approval", "failed", "cancelled"],
  ready: ["running", "paused", "resuming", "failed", "cancelled"],
  running: ["blocked", "needs_approval", "verifying", "paused", "resuming", "completed", "failed", "cancelled"],
  blocked: ["needs_approval", "running", "paused", "resuming", "failed", "cancelled"],
  needs_approval: ["ready", "paused", "resuming", "failed", "cancelled"],
  verifying: ["running", "paused", "resuming", "completed", "failed", "cancelled"],
  paused: ["resuming", "failed", "cancelled"],
  resuming: ["preparing", "ready", "running", "blocked", "needs_approval", "paused", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};

export class InvalidSessionTransitionError extends Error {
  constructor(readonly from: SessionState, readonly to: SessionState) {
    super(`Illegal session transition: ${from} -> ${to}`);
  }
}

export function isTerminalSessionState(state: SessionState): boolean {
  return TERMINAL_SESSION_STATES.includes(state);
}

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  return from === to || VALID_SESSION_TRANSITIONS[from].includes(to);
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  if (!canTransitionSession(from, to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
}

export function transitionSession(
  session: Session,
  to: SessionState,
  options?: {
    at?: string;
    summary?: string;
    error?: string;
  }
): Session {
  assertSessionTransition(session.state, to);
  const at = options?.at ?? nowIso();
  return {
    ...session,
    state: to,
    updatedAt: at,
    ...(options?.summary !== undefined ? { currentSummary: options.summary } : {}),
    ...(options?.error !== undefined ? { lastError: options.error } : {})
  };
}

function stateFromEvent(event: SessionEvent): SessionState | undefined {
  switch (event.type as EventName) {
    case "SessionCreated":
      return "created";
    case "PromptBuilt":
    case "SessionAssigned":
      return "preparing";
    case "ApprovalRequested":
      return "needs_approval";
    case "ApprovalResolved": {
      const decision = String((event.payload as { decision?: unknown }).decision ?? "");
      return decision === "denied" || decision === "expired" ? "paused" : "ready";
    }
    case "ToolCallQueued":
      return "ready";
    case "ToolCallStarted":
    case "SessionStarted":
      return "running";
    case "VerificationStarted":
      return "verifying";
    case "VerificationPassed":
    case "SessionCompleted":
      return "completed";
    case "VerificationFailed":
    case "VerificationInconclusive":
      return "running";
    case "SessionPaused":
      return "paused";
    case "SessionResumed":
    case "HostDisconnected":
    case "HostReconnected":
      return "resuming";
    case "SessionFailed":
      return "failed";
    case "SessionCancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

export function reduceSessionEvent(session: Session, event: SessionEvent): Session {
  const nextState = stateFromEvent(event);
  if (!nextState) {
    return session;
  }

  if (!canTransitionSession(session.state, nextState)) {
    throw new InvalidSessionTransitionError(session.state, nextState);
  }

  const summary = event.type === "SummaryGenerated"
    ? String((event.payload as { summary?: unknown }).summary ?? session.currentSummary ?? "")
    : undefined;
  const error = event.type === "SessionFailed"
    ? String((event.payload as { reason?: unknown }).reason ?? session.lastError ?? "")
    : undefined;

  return transitionSession(session, nextState, {
    at: event.occurredAt,
    summary,
    error
  });
}

export function reduceSessionEvents(session: Session, events: SessionEvent[]): Session {
  return events
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .reduce((current, event) => reduceSessionEvent(current, event), session);
}

export function nextResumeState(session: Session): SessionState {
  return isTerminalSessionState(session.state) ? session.state : "resuming";
}
