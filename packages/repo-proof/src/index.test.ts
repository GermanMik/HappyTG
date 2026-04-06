import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { freezeTaskSpec, initTaskBundle, updateEvidence, validateTaskBundle, writeVerificationVerdict } from "./index.js";

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

  assert.equal(task.phase, "init");

  const frozen = await freezeTaskSpec(task, {
    problem: "Verify repo proof behavior",
    verificationPlan: ["run verifier"]
  });
  assert.equal(frozen.phase, "spec_frozen");

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

  const spec = await readFile(path.join(task.rootPath, "spec.md"), "utf8");
  assert.match(spec, /Status: frozen/);
});
