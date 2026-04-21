import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TASK_METADATA_FILE,
  TASK_STATE_FILE,
  advanceTaskPhase,
  freezeTaskSpec,
  initTaskBundle,
  markVerificationStaleAfterMutation,
  readTaskBundle,
  readTaskBundleState,
  recordTaskApproval,
  updateEvidence,
  validateTaskBundle,
  writeVerificationVerdict
} from "./index.js";

test("repo proof bundle can be initialized, frozen, validated, and verified", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "happytg-proof-"));
  const task = await initTaskBundle({
    repoRoot,
    taskId: "HTG-9999",
    sessionId: "ses_1",
    workspaceId: "ws_1",
    title: "Proof test",
    acceptanceCriteria: ["criterion one", "criterion two"],
    mode: "proof"
  });

  assert.equal(task.phase, "freeze");

  const frozen = await freezeTaskSpec(task, {
    problem: "Verify repo proof behavior",
    verificationPlan: ["run verifier"]
  });
  assert.equal(frozen.phase, "freeze");

  const evidenced = await updateEvidence(frozen, "criterion evidence", [path.join(frozen.rootPath, "raw", "build.txt")]);
  assert.equal(evidenced.phase, "evidence");

  const verdict = await writeVerificationVerdict({
    task: evidenced,
    runId: "vrf_1",
    status: "passed",
    checks: [{ name: "verifier", ok: true, detail: "ok" }],
    findings: [],
    summary: "VERDICT: PASS"
  });

  assert.equal(verdict.task.phase, "complete");
  assert.equal(verdict.task.verificationState, "passed");

  const validation = await validateTaskBundle(task.rootPath);
  assert.equal(validation.ok, true);
  assert.equal(validation.canonicalOk, true);

  const spec = await readFile(path.join(task.rootPath, "spec.md"), "utf8");
  const state = await readFile(path.join(task.rootPath, TASK_STATE_FILE), "utf8");
  const metadata = await readTaskBundle(task.rootPath);
  const metadataRaw = await readFile(path.join(task.rootPath, TASK_METADATA_FILE), "utf8");
  assert.match(spec, /Status: frozen/);
  assert.match(state, /"current_phase": "complete"/);
  assert.match(state, /"verification_state": "passed"/);
  assert.equal(metadata?.id, "HTG-9999");
  assert.equal(metadata?.verificationState, "passed");
  assert.match(metadataRaw, /HTG-9999/);
});

test("repo proof state tracks explicit phase advances, approvals, and stale verification", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "happytg-proof-state-"));
  const task = await initTaskBundle({
    repoRoot,
    taskId: "HTG-8888",
    sessionId: "ses_2",
    workspaceId: "ws_2",
    title: "State test",
    acceptanceCriteria: ["criterion"],
    mode: "proof"
  });

  const building = await advanceTaskPhase(task, "build", "ToolCallStarted", "running");
  await recordTaskApproval(building, "apr_1");
  const stateAfterApproval = await readTaskBundleState(task.rootPath);

  assert.equal(stateAfterApproval?.current_phase, "build");
  assert.equal(stateAfterApproval?.verification_state, "running");
  assert.deepEqual(stateAfterApproval?.approvals, ["apr_1"]);

  const verdict = await writeVerificationVerdict({
    task: building,
    runId: "vrf_2",
    status: "passed",
    checks: [{ name: "verifier", ok: true, detail: "ok" }],
    findings: [],
    summary: "VERDICT: PASS"
  });
  const stale = await markVerificationStaleAfterMutation(verdict.task, "ToolCallFinished");
  const stateAfterMutation = await readTaskBundleState(task.rootPath);

  assert.equal(stale.phase, "fix");
  assert.equal(stale.verificationState, "stale");
  assert.equal(stateAfterMutation?.current_phase, "fix");
  assert.equal(stateAfterMutation?.verification_state, "stale");
});
