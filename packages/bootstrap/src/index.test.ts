import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBootstrapCommand } from "./index.js";

async function writeNodeEntrypoint(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
}

async function writeFakeGitBinary(filePath: string): Promise<void> {
  await writeFile(
    filePath,
    process.platform === "win32" ? "@echo off\r\necho git test\r\n" : "#!/bin/sh\necho git test\n",
    "utf8"
  );

  if (process.platform !== "win32") {
    await chmod(filePath, 0o755);
  }
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

test("doctor writes a report, detects Git via PATH, and flags missing Codex config as warn", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-doctor-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR,
    PATH: process.env.PATH
  };

  try {
    const binaryPath = path.join(tempDir, "codex-doctor.mjs");
    const gitBinaryPath = path.join(tempDir, process.platform === "win32" ? "git.cmd" : "git");
    await Promise.all([
      writeNodeEntrypoint(
        binaryPath,
        `
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex test 1.0");
            process.exit(0);
          }
          console.error("unexpected invocation");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitBinaryPath)
    ]);

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = path.join(tempDir, "missing-config.toml");
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");
    process.env.PATH = tempDir;

    const report = await runBootstrapCommand("doctor");
    const stored = JSON.parse(await readFile(path.join(process.env.HAPPYTG_STATE_DIR, "state", "doctor-last.json"), "utf8")) as typeof report;

    assert.equal(report.command, "doctor");
    assert.equal(report.status, "warn");
    assert.equal(stored.id, report.id);
    assert.ok(report.findings.some((item) => item.code === "CODEX_CONFIG_MISSING"));
    assert.deepEqual(report.reportJson.git, {
      available: true,
      binaryPath: gitBinaryPath
    });
    assert.ok(report.planPreview.includes("Create `~/.codex/config.toml`, then rerun `pnpm happytg doctor`."));
  } finally {
    restoreEnv(envSnapshot);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify surfaces Codex smoke warnings as warn when config exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-verify-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR,
    PATH: process.env.PATH
  };

  try {
    const binaryPath = path.join(tempDir, "codex-verify.mjs");
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, process.platform === "win32" ? "git.cmd" : "git");
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeNodeEntrypoint(
        binaryPath,
        `
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex test 1.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            console.error("sqlite warning");
            process.exit(0);
          }
          console.error("unexpected invocation");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitBinaryPath)
    ]);

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");
    process.env.PATH = tempDir;

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

test("doctor ignores known benign Codex internal smoke warnings while keeping raw diagnostics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-benign-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR,
    PATH: process.env.PATH
  };

  try {
    const binaryPath = path.join(tempDir, "codex-benign.mjs");
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, process.platform === "win32" ? "git.cmd" : "git");
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeNodeEntrypoint(
        binaryPath,
        `
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex test 1.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            console.error("2026-04-08T00:00:00.000Z WARN codex_state::runtime: failed to open state db at /tmp/state.sqlite: migration 21 was previously applied but is missing in the resolved migrations");
            console.error("2026-04-08T00:00:00.000Z WARN codex_core::rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back");
            console.error("2026-04-08T00:00:00.000Z WARN codex_core::shell_snapshot: Failed to delete shell snapshot at \\"/tmp/snapshot\\": Os { code: 2, kind: NotFound, message: \\"No such file or directory\\" }");
            process.exit(0);
          }
          console.error("unexpected invocation");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitBinaryPath)
    ]);

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");
    process.env.PATH = tempDir;

    const report = await runBootstrapCommand("doctor");

    assert.equal(report.status, "pass");
    assert.equal(report.findings.length, 0);
    assert.match(String((report.reportJson.codex as { smokeError?: string }).smokeError ?? ""), /failed to open state db/);
  } finally {
    restoreEnv(envSnapshot);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor stays green when smoke stderr contains only known benign Codex internal warnings", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-benign-"));
  const envSnapshot = {
    CODEX_CLI_BIN: process.env.CODEX_CLI_BIN,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR,
    PATH: process.env.PATH
  };

  try {
    const binaryPath = path.join(tempDir, "codex-benign.mjs");
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, process.platform === "win32" ? "git.cmd" : "git");
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeNodeEntrypoint(
        binaryPath,
        `
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex test 1.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            console.error("2026-04-08T14:03:06Z  WARN codex_state::runtime: failed to open state db at /Users/example/.codex/state_5.sqlite: migration 21 was previously applied but is missing in the resolved migrations");
            console.error("2026-04-08T14:03:06Z  WARN codex_core::state_db: failed to initialize state runtime at /Users/example/.codex: migration 21 was previously applied but is missing in the resolved migrations");
            console.error("2026-04-08T14:03:06Z  WARN codex_core::rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back");
            console.error("2026-04-08T14:03:06Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at \\"/tmp/example\\": Os { code: 2, kind: NotFound, message: \\"No such file or directory\\" }");
            console.error("2026-04-08T14:03:06Z ERROR codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit");
            process.exit(0);
          }
          console.error("unexpected invocation");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitBinaryPath)
    ]);

    process.env.CODEX_CLI_BIN = binaryPath;
    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.HAPPYTG_STATE_DIR = path.join(tempDir, ".happytg-state");
    process.env.PATH = tempDir;

    const report = await runBootstrapCommand("doctor");

    assert.equal(report.status, "pass");
    assert.ok(!report.findings.some((item) => item.code === "CODEX_SMOKE_WARNINGS"));
    assert.match(String(report.reportJson.codex && (report.reportJson.codex as Record<string, unknown>).smokeError), /failed to open state db/);
    assert.match(String(report.reportJson.codex && (report.reportJson.codex as Record<string, unknown>).smokeError), /failed to refresh available models/);
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
