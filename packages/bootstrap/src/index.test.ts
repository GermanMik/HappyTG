import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { runBootstrapCommand } from "./index.js";

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
  await chmod(filePath, 0o755);
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("doctor writes a report and flags missing Codex config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-doctor-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR
  };

  try {
    const binaryPath = path.join(tempDir, "codex");
    await writeExecutable(
      binaryPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '  echo "codex test 1.0"',
        "  exit 0",
        "fi",
        'echo "unexpected invocation" 1>&2',
        "exit 1"
      ].join("\n")
    );

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = path.join(tempDir, "missing-config.toml");
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");

    const report = await runBootstrapCommand("doctor");
    const stored = JSON.parse(await readFile(path.join(process.env.HAPPYTG_STATE_DIR, "state", "doctor-last.json"), "utf8")) as typeof report;

    assert.equal(report.command, "doctor");
    assert.equal(report.status, "warn");
    assert.equal(stored.id, report.id);
    assert.ok(report.findings.some((item) => item.code === "CODEX_CONFIG_MISSING"));
    assert.ok(report.planPreview.includes("Initialize ~/.codex/config.toml"));
  } finally {
    restoreEnv(envSnapshot);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify surfaces Codex smoke warnings when config exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-verify-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR
  };

  try {
    const binaryPath = path.join(tempDir, "codex");
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");
    await writeExecutable(
      binaryPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '  echo "codex test 1.0"',
        "  exit 0",
        "fi",
        'if [ "$1" = "exec" ]; then',
        '  echo "{\\"type\\":\\"message\\",\\"text\\":\\"OK\\"}"',
        '  echo "sqlite warning" 1>&2',
        "  exit 0",
        "fi",
        'echo "unexpected invocation" 1>&2',
        "exit 1"
      ].join("\n")
    );

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");

    const report = await runBootstrapCommand("verify");

    assert.equal(report.command, "verify");
    assert.equal(report.status, "warn");
    assert.ok(report.findings.some((item) => item.code === "CODEX_SMOKE_WARNINGS"));
    assert.match(report.reportJson.platform as string, /-/);
  } finally {
    restoreEnv(envSnapshot);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("config-init and env-snapshot remain deterministic plan-only commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-config-"));
  const envSnapshot = {
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR
  };

  try {
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");

    const configReport = await runBootstrapCommand("config-init");
    const envReport = await runBootstrapCommand("env-snapshot");

    assert.equal(configReport.status, "warn");
    assert.ok(configReport.findings.some((item) => item.code === "CONFIG_INIT_PLAN_ONLY"));
    assert.equal(envReport.status, "pass");
    assert.equal(typeof envReport.reportJson.node, "string");
    assert.equal(envReport.reportJson.cwd, process.cwd());
  } finally {
    restoreEnv(envSnapshot);
    await rm(tempDir, { recursive: true, force: true });
  }
});
