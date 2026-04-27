import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEmptyStore } from "../../../../packages/protocol/src/index.ts";
import { runCodexExec } from "../../../../packages/runtime-adapters/src/index.ts";
import { compactControlPlaneRecords } from "../../../../apps/worker/src/reconcile.ts";

function sample(label) {
  global.gc?.();
  return {
    label,
    ...process.memoryUsage()
  };
}

function oldIso(now, days) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

async function createHarness(tempDir, fileName, source) {
  const filePath = path.join(tempDir, fileName);
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  return {
    binaryPath: process.execPath,
    binaryArgs: [filePath]
  };
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-memory-smoke-"));
const previousCap = process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES;
const previousGrace = process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS;

try {
  process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES = "4096";
  process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS = "20";

  const largeOutput = await createHarness(tempDir, "codex-large-output.mjs", `
    if (process.argv.slice(2)[0] !== "exec") process.exit(1);
    process.stdout.write("stdout-" + "x".repeat(256 * 1024) + "-tail");
    process.stderr.write("stderr-" + "y".repeat(256 * 1024) + "-tail");
  `);
  const hung = await createHarness(tempDir, "codex-hung.mjs", `
    if (process.argv.slice(2)[0] !== "exec") process.exit(1);
    process.on("SIGTERM", () => {});
    setInterval(() => process.stdout.write("tick\\n"), 100);
  `);

  const samples = [sample("start")];
  for (let index = 0; index < 5; index += 1) {
    const output = await runCodexExec({
      cwd: tempDir,
      prompt: `large ${index}`,
      binaryPath: largeOutput.binaryPath,
      binaryArgs: largeOutput.binaryArgs,
      outputDir: tempDir
    });
    if (!output.stdoutTruncated || !output.stderrTruncated) {
      throw new Error("large output was not truncated");
    }

    const timeout = await runCodexExec({
      cwd: tempDir,
      prompt: `timeout ${index}`,
      binaryPath: hung.binaryPath,
      binaryArgs: hung.binaryArgs,
      outputDir: tempDir,
      timeoutMs: 10
    });
    if (!timeout.timedOut || timeout.exitCode !== 124) {
      throw new Error("hung child did not settle as timeout");
    }
    samples.push(sample(`child-iteration-${index}`));
  }

  const now = Date.parse("2026-04-27T12:00:00.000Z");
  const store = createEmptyStore();
  for (let index = 0; index < 250; index += 1) {
    store.miniAppLaunchGrants.push({
      id: `grant_${index}`,
      kind: "session",
      payload: `payload_${index}`,
      nonce: `nonce_${index}`,
      expiresAt: oldIso(now, 2),
      maxUses: 1,
      uses: 0,
      createdAt: oldIso(now, 3),
      updatedAt: oldIso(now, 3)
    });
    store.miniAppSessions.push({
      id: `mas_${index}`,
      userId: "usr_1",
      telegramUserId: "42",
      tokenHash: `hash_${index}`,
      expiresAt: oldIso(now, 2),
      createdAt: oldIso(now, 3),
      lastSeenAt: oldIso(now, 3)
    });
  }
  const compaction = compactControlPlaneRecords(store, now, {
    terminalRecordRetentionMs: 7 * 24 * 60 * 60 * 1000,
    hostRegistrationRetentionMs: 24 * 60 * 60 * 1000
  });
  samples.push(sample("after-compaction"));

  console.log(JSON.stringify({
    ok: true,
    compaction,
    remainingLaunchGrants: store.miniAppLaunchGrants.length,
    remainingMiniAppSessions: store.miniAppSessions.length,
    samples
  }, null, 2));
} finally {
  if (previousCap === undefined) {
    delete process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES;
  } else {
    process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES = previousCap;
  }
  if (previousGrace === undefined) {
    delete process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS;
  } else {
    process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS = previousGrace;
  }
  await rm(tempDir, { recursive: true, force: true });
}
