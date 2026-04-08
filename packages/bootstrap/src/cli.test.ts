import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeHappyTG, parseHappyTGArgs } from "./cli.js";

test("parseHappyTGArgs maps config and env nested commands", () => {
  assert.deepEqual(parseHappyTGArgs(["config", "init", "--json"]), {
    kind: "bootstrap",
    command: "config-init",
    json: true
  });

  assert.deepEqual(parseHappyTGArgs(["env", "snapshot"]), {
    kind: "bootstrap",
    command: "env-snapshot",
    json: false
  });
});

test("executeHappyTG initializes and inspects repo-local task bundles", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "happytg-cli-task-"));

  try {
    const initialized = await executeHappyTG([
      "task",
      "init",
      "--repo",
      repoRoot,
      "--task",
      "HTG-3000",
      "--session",
      "ses_manual",
      "--workspace",
      "ws_manual",
      "--title",
      "Manual proof bundle",
      "--criterion",
      "criterion one",
      "--criterion",
      "criterion two"
    ]) as { id: string; phase: string; verificationState: string; rootPath: string };

    assert.equal(initialized.id, "HTG-3000");
    assert.equal(initialized.phase, "init");
    assert.equal(initialized.verificationState, "not_started");

    const status = await executeHappyTG([
      "task",
      "status",
      "--repo",
      repoRoot,
      "--task",
      "HTG-3000"
    ]) as { task?: { id: string; title: string }; validation: { ok: boolean } };

    assert.equal(status.validation.ok, true);
    assert.equal(status.task?.id, "HTG-3000");
    assert.equal(status.task?.title, "Manual proof bundle");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
