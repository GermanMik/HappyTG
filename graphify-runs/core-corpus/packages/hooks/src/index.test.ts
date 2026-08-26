import assert from "node:assert/strict";
import test from "node:test";

import { defineHook, executeHook } from "./index.js";

test("defineHook creates an enabled hook definition for the requested point", () => {
  const hook = defineHook("task.verify", "local://verify-hook");

  assert.match(hook.id, /^hook_/);
  assert.equal(hook.point, "task.verify");
  assert.equal(hook.enabled, true);
  assert.equal(hook.handlerRef, "local://verify-hook");
});

test("executeHook returns a completed execution envelope", async () => {
  const hook = defineHook("approval.requested", "local://approval-hook");
  const execution = await executeHook(hook, "ses_123");

  assert.match(execution.id, /^hke_/);
  assert.equal(execution.hookId, hook.id);
  assert.equal(execution.sessionId, "ses_123");
  assert.equal(execution.status, "completed");
  assert.equal(execution.outputRef, "local://approval-hook");
  assert.ok(execution.startedAt);
  assert.ok(execution.finishedAt);
});
