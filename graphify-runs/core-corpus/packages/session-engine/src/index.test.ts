import assert from "node:assert/strict";
import test from "node:test";

import type { Session, SessionEvent } from "../../protocol/src/index.js";

import {
  InvalidSessionTransitionError,
  canTransitionSession,
  nextResumeState,
  reduceSessionEvents,
  transitionSession
} from "./index.js";

const now = "2026-04-21T00:00:00.000Z";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    userId: "usr_1",
    hostId: "host_1",
    workspaceId: "ws_1",
    mode: "proof",
    runtime: "codex-cli",
    state: "created",
    title: "test",
    prompt: "test",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function event(sequence: number, type: SessionEvent["type"], payload: SessionEvent["payload"] = {}): SessionEvent {
  return {
    id: `evt_${sequence}`,
    sessionId: "ses_1",
    type,
    payload,
    occurredAt: new Date(Date.parse(now) + sequence * 1000).toISOString(),
    sequence
  };
}

test("transitionSession allows the canonical proof happy path", () => {
  let current = session();
  current = transitionSession(current, "preparing");
  current = transitionSession(current, "needs_approval");
  current = transitionSession(current, "ready");
  current = transitionSession(current, "running");
  current = transitionSession(current, "verifying");
  current = transitionSession(current, "completed");

  assert.equal(current.state, "completed");
});

test("transitionSession rejects illegal terminal transitions", () => {
  assert.equal(canTransitionSession("completed", "running"), false);
  assert.throws(
    () => transitionSession(session({ state: "completed" }), "running"),
    InvalidSessionTransitionError
  );
});

test("nextResumeState preserves terminal sessions and resumes active sessions", () => {
  assert.equal(nextResumeState(session({ state: "running" })), "resuming");
  assert.equal(nextResumeState(session({ state: "needs_approval" })), "resuming");
  assert.equal(nextResumeState(session({ state: "completed" })), "completed");
});

test("reduceSessionEvents replays typed event state changes in sequence order", () => {
  const reduced = reduceSessionEvents(session(), [
    event(4, "ToolCallStarted"),
    event(1, "PromptBuilt"),
    event(2, "ApprovalRequested", { approvalId: "apr_1" }),
    event(3, "ApprovalResolved", { approvalId: "apr_1", decision: "approved_once" }),
    event(5, "VerificationStarted"),
    event(6, "VerificationPassed")
  ]);

  assert.equal(reduced.state, "completed");
  assert.equal(reduced.updatedAt, new Date(Date.parse(now) + 6000).toISOString());
});
