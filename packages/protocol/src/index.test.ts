import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_KINDS,
  APPROVAL_STATES,
  DAEMON_MESSAGE_TYPES,
  DISPATCH_EXECUTION_KINDS,
  EVENT_NAMES,
  SESSION_STATES,
  TASK_PHASES,
  VERIFICATION_STATES,
  createEmptyStore
} from "./index.js";

test("createEmptyStore returns the canonical empty control-plane shape", () => {
  const store = createEmptyStore();

  assert.equal(store.version, 1);
  assert.deepEqual(store.users, []);
  assert.deepEqual(store.telegramIdentities, []);
  assert.deepEqual(store.hosts, []);
  assert.deepEqual(store.sessions, []);
  assert.deepEqual(store.tasks, []);
  assert.deepEqual(store.approvals, []);
  assert.deepEqual(store.pendingDispatches, []);
  assert.deepEqual(store.bootstrapReports, []);
});

test("protocol enums include resumability, proof, and bootstrap contracts", () => {
  assert.ok(SESSION_STATES.includes("reconnecting"));
  assert.ok(SESSION_STATES.includes("verifying"));
  assert.ok(TASK_PHASES.includes("spec_frozen"));
  assert.ok(TASK_PHASES.includes("fix"));
  assert.ok(APPROVAL_STATES.includes("expired"));
  assert.ok(VERIFICATION_STATES.includes("passed"));
  assert.ok(VERIFICATION_STATES.includes("blocked"));
  assert.ok(ACTION_KINDS.includes("session_resume"));
  assert.ok(ACTION_KINDS.includes("verification_run"));
  assert.ok(ACTION_KINDS.includes("bootstrap_install"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("runtime_session"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("bootstrap_doctor"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("bootstrap_verify"));
  assert.ok(EVENT_NAMES.includes("session.prefetch.completed"));
  assert.ok(EVENT_NAMES.includes("verification.completed"));
  assert.ok(DAEMON_MESSAGE_TYPES.includes("host.resume"));
  assert.ok(DAEMON_MESSAGE_TYPES.includes("approval.blocked"));
});
