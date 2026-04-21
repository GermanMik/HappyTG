import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_KINDS,
  APPROVAL_SCOPES,
  APPROVAL_STATES,
  DAEMON_MESSAGE_TYPES,
  DISPATCH_EXECUTION_KINDS,
  EVENT_CONTRACTS,
  EVENT_NAMES,
  MINIAPP_LAUNCH_KINDS,
  SESSION_STATES,
  TASK_PHASES,
  TOOL_CATEGORIES,
  VERIFICATION_STATES,
  createEmptyStore
} from "./index.js";

test("createEmptyStore returns the canonical empty control-plane shape", () => {
  const store = createEmptyStore();

  assert.equal(store.version, 1);
  assert.deepEqual(store.users, []);
  assert.deepEqual(store.telegramIdentities, []);
  assert.deepEqual(store.miniAppLaunchGrants, []);
  assert.deepEqual(store.miniAppSessions, []);
  assert.deepEqual(store.hosts, []);
  assert.deepEqual(store.sessions, []);
  assert.deepEqual(store.tasks, []);
  assert.deepEqual(store.approvals, []);
  assert.deepEqual(store.mcpBindings, []);
  assert.deepEqual(store.pendingDispatches, []);
  assert.deepEqual(store.bootstrapReports, []);
});

test("protocol enums include resumability, proof, and bootstrap contracts", () => {
  assert.ok(SESSION_STATES.includes("resuming"));
  assert.ok(SESSION_STATES.includes("needs_approval"));
  assert.ok(SESSION_STATES.includes("verifying"));
  assert.ok(TASK_PHASES.includes("freeze"));
  assert.ok(TASK_PHASES.includes("fix"));
  assert.ok(APPROVAL_STATES.includes("expired"));
  assert.ok(APPROVAL_STATES.includes("approved_once"));
  assert.ok(VERIFICATION_STATES.includes("passed"));
  assert.ok(VERIFICATION_STATES.includes("inconclusive"));
  assert.ok(ACTION_KINDS.includes("session_resume"));
  assert.ok(ACTION_KINDS.includes("verification_run"));
  assert.ok(ACTION_KINDS.includes("bootstrap_install"));
  assert.ok(APPROVAL_SCOPES.includes("phase"));
  assert.ok(MINIAPP_LAUNCH_KINDS.includes("approval"));
  assert.ok(MINIAPP_LAUNCH_KINDS.includes("verify"));
  assert.ok(TOOL_CATEGORIES.includes("repo_mutation"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("runtime_session"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("bootstrap_doctor"));
  assert.ok(DISPATCH_EXECUTION_KINDS.includes("bootstrap_verify"));
  assert.ok(EVENT_NAMES.includes("PromptBuilt"));
  assert.ok(EVENT_NAMES.includes("VerificationPassed"));
  assert.ok(DAEMON_MESSAGE_TYPES.includes("host.resume"));
  assert.ok(DAEMON_MESSAGE_TYPES.includes("approval.blocked"));
});

test("event contracts document producers, consumers, payloads, and idempotency", () => {
  const names = new Set(EVENT_CONTRACTS.map((contract) => contract.name));
  assert.ok(names.has("SessionCreated"));
  assert.ok(names.has("ApprovalRequested"));
  assert.ok(names.has("TaskBundleUpdated"));
  assert.ok(names.has("VerificationPassed"));
  for (const contract of EVENT_CONTRACTS) {
    assert.ok(contract.payloadShape.length > 0);
    assert.ok(contract.producer.length > 0);
    assert.ok(contract.consumers.length > 0);
    assert.ok(contract.idempotencyNotes.length > 0);
  }
});
