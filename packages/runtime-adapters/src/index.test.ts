import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkCodexReadiness,
  classifyActionKind,
  classifyCodexSmokeStderr,
  codexCliMissingMessage,
  planToolExecutionBatches,
  runCodexExec,
  summarizeCodexSmokeStderr,
  toolExecutionPolicyForAction
} from "./index.js";

async function writeNodeEntrypoint(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
}

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  if (process.platform !== "win32") {
    await chmod(filePath, 0o755);
  }
}

function batchQuote(value: string): string {
  return value.replace(/"/g, "\"\"");
}

function shellQuote(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

async function createCodexHarness(tempDir: string, fileName: string, source: string): Promise<{ binaryPath: string; binaryArgs: string[] }> {
  const entrypointPath = path.join(tempDir, fileName);
  await writeNodeEntrypoint(entrypointPath, source);
  return {
    binaryPath: process.execPath,
    binaryArgs: [entrypointPath]
  };
}

async function createWindowsCodexShim(tempDir: string, version: string): Promise<{ shimPath: string }> {
  const scriptName = "codex-shim.mjs";
  const scriptPath = path.join(tempDir, scriptName);
  await writeNodeEntrypoint(
    scriptPath,
    `
      const args = process.argv.slice(2);
      if (args[0] === "--version") {
        console.log(${JSON.stringify(version)});
        process.exit(0);
      }
      if (args[0] === "exec") {
        console.log('{"type":"message","text":"OK"}');
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, "codex.cmd");
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${batchQuote(process.execPath)}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\nnode "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
    return { shimPath };
  }

  await writeExecutable(
    shimPath,
    `
      #!/bin/sh
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec "${shellQuote(process.execPath)}" "$SCRIPT_DIR/${scriptName}" "$@"
    `
  );
  return { shimPath };
}

async function createStrictWindowsCodexShim(tempDir: string, version: string, expectedPrompt: string): Promise<{ shimPath: string }> {
  const scriptName = "codex-strict-shim.mjs";
  const scriptPath = path.join(tempDir, scriptName);
  await writeNodeEntrypoint(
    scriptPath,
    `
      const args = process.argv.slice(2);
      if (args[0] === "--version") {
        console.log(${JSON.stringify(version)});
        process.exit(0);
      }
      if (args[0] === "exec") {
        const expected = ["exec", "--skip-git-repo-check", "--json", ${JSON.stringify(expectedPrompt)}];
        const matches = args.length === expected.length && args.every((value, index) => value === expected[index]);
        if (!matches) {
          console.error(\`unexpected exec args: \${JSON.stringify(args)}\`);
          process.exit(1);
        }
        console.log('{"type":"message","text":"OK"}');
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, "codex.cmd");
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${batchQuote(process.execPath)}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\nnode "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
    return { shimPath };
  }

  await writeExecutable(
    shimPath,
    `
      #!/bin/sh
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec "${shellQuote(process.execPath)}" "$SCRIPT_DIR/${scriptName}" "$@"
    `
  );
  return { shimPath };
}

async function createTempDirWithSpace(prefix: string): Promise<{ tempRoot: string; tempDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const tempDir = path.join(tempRoot, "dir with space");
  await mkdir(tempDir, { recursive: true });
  return { tempRoot, tempDir };
}

function restoreCodexBin(originalValue: string | undefined): void {
  if (originalValue === undefined) {
    delete process.env.CODEX_CLI_BIN;
    return;
  }

  process.env.CODEX_CLI_BIN = originalValue;
}

test("checkCodexReadiness reports available Codex and captures smoke warnings", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-ready-"));
  try {
    const harness = await createCodexHarness(
      tempDir,
      "codex-harness.mjs",
      `
        const args = process.argv.slice(2);
        if (args[0] === "--version") {
          console.log("codex test 1.0");
          process.exit(0);
        }
        if (args[0] === "exec") {
          console.log('{"type":"message","text":"OK"}');
          console.error("migration warning");
          process.exit(0);
        }
        console.error("unexpected invocation");
        process.exit(1);
      `
    );
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      configPath,
      smokePrompt: "Print exactly OK and exit."
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.configExists, true);
    assert.equal(readiness.smokeOk, true);
    assert.match(readiness.version ?? "", /codex test 1\.0/);
    assert.match(readiness.smokeError ?? "", /migration warning/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("tool execution model classifies actions and serializes mutations", () => {
  assert.equal(classifyActionKind("workspace_read"), "safe_read");
  assert.equal(classifyActionKind("verification_run"), "bounded_compute");
  assert.equal(classifyActionKind("workspace_write"), "repo_mutation");
  assert.equal(classifyActionKind("git_push"), "deploy_publish_external_side_effect");

  assert.equal(toolExecutionPolicyForAction("workspace_read").defaultPolicy, "allow");
  assert.equal(toolExecutionPolicyForAction("workspace_write").defaultPolicy, "require_approval");
  assert.equal(toolExecutionPolicyForAction("git_push").defaultPolicy, "deny");

  const batches = planToolExecutionBatches([
    { id: "read-1", actionKind: "read_status" },
    { id: "read-2", actionKind: "workspace_read" },
    { id: "write-1", actionKind: "workspace_write" },
    { id: "verify-1", actionKind: "verification_run" },
    { id: "push-1", actionKind: "git_push" }
  ]);

  assert.deepEqual(batches.map((batch) => `${batch.mode}:${batch.calls.map((call) => call.id).join(",")}`), [
    "parallel:read-1,read-2",
    "serial:write-1",
    "parallel:verify-1",
    "serial:push-1"
  ]);
});

test("checkCodexReadiness resolves a Windows-style codex.cmd shim from Path", async () => {
  const { tempRoot, tempDir } = await createTempDirWithSpace("happytg-runtime-win-shim-");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const { shimPath } = await createWindowsCodexShim(tempDir, "codex shim 0.115.0");
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8")
    ]);

    const readiness = await checkCodexReadiness({
      env: {
        PATH: "C:\\wrong-path",
        Path: tempDir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD"
      },
      platform: "win32",
      cwd: tempDir,
      configPath
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.missing, false);
    assert.equal(readiness.smokeOk, true);
    assert.match(readiness.version ?? "", /codex shim 0\.115\.0/);
    assert.equal(readiness.binaryPath, shimPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("checkCodexReadiness resolves a Windows-style codex.cmd shim from lowercase path and pathext", async () => {
  const { tempRoot, tempDir } = await createTempDirWithSpace("happytg-runtime-win-shim-case-");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const { shimPath } = await createWindowsCodexShim(tempDir, "codex shim 0.116.0");
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8")
    ]);

    const readiness = await checkCodexReadiness({
      env: {
        path: tempDir,
        pathext: ".cmd;.exe"
      } as NodeJS.ProcessEnv,
      platform: "win32",
      cwd: tempDir,
      configPath
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.missing, false);
    assert.equal(readiness.smokeOk, true);
    assert.match(readiness.version ?? "", /codex shim 0\.116\.0/);
    assert.equal(readiness.binaryPath, shimPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("checkCodexReadiness keeps Windows shim resolution working when PATH/Path and PATHEXT/pathext are duplicated", async () => {
  const { tempRoot, tempDir } = await createTempDirWithSpace("happytg-runtime-win-shim-dupe-");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const { shimPath } = await createWindowsCodexShim(tempDir, "codex shim 0.117.0");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      env: {
        Path: "",
        PATH: tempDir,
        PATHEXT: "",
        pathext: ".cmd;.exe"
      } as NodeJS.ProcessEnv,
      platform: "win32",
      cwd: tempDir,
      configPath
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.missing, false);
    assert.equal(readiness.smokeOk, true);
    assert.match(readiness.version ?? "", /codex shim 0\.117\.0/);
    assert.equal(readiness.binaryPath, shimPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("checkCodexReadiness closes stdin so smoke runs do not hang waiting for EOF", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-stdin-"));
  try {
    const harness = await createCodexHarness(
      tempDir,
      "codex-stdin-harness.mjs",
      `
        import fs from "node:fs";
        const args = process.argv.slice(2);
        if (args[0] === "--version") {
          console.log("codex test 1.0");
          process.exit(0);
        }
        if (args[0] === "exec") {
          fs.readFileSync(0, "utf8");
          console.log('{"type":"message","text":"OK"}');
          process.exit(0);
        }
        console.error("unexpected invocation");
        process.exit(1);
      `
    );
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      configPath,
      env: {
        HAPPYTG_CODEX_EXEC_TIMEOUT_MS: "1000"
      }
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.smokeOk, true);
    assert.equal(readiness.smokeTimedOut, false);
    assert.match(readiness.smokeOutput ?? "", /"text":"OK"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkCodexReadiness preserves spaced prompts when it runs through a Windows cmd wrapper", async () => {
  const { tempRoot, tempDir } = await createTempDirWithSpace("happytg-runtime-win-prompt-");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const prompt = "Print exactly OK and exit.";
    const { shimPath } = await createStrictWindowsCodexShim(tempDir, "codex shim 0.118.0", prompt);
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      binaryPath: shimPath,
      configPath,
      platform: "win32",
      cwd: tempDir,
      smokePrompt: prompt
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.smokeOk, true);
    assert.equal(readiness.binaryPath, shimPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("checkCodexReadiness treats a Windows shell command-not-found result as missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-win-missing-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      env: {
        Path: tempDir,
        PATHEXT: ".CMD;.EXE"
      } as NodeJS.ProcessEnv,
      platform: "win32",
      cwd: tempDir,
      configPath
    });

    assert.equal(readiness.available, false);
    assert.equal(readiness.missing, true);
    assert.equal(readiness.binaryPath, "codex");
    assert.match(readiness.smokeError ?? "", /not on the current shell PATH yet/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkCodexReadiness marks only true ENOENT failures as missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-broken-codex-"));
  try {
    const brokenBinary = path.join(tempDir, "codex-broken.mjs");
    await writeNodeEntrypoint(
      brokenBinary,
      `
        process.stderr.write("broken codex version\\n");
        process.exit(1);
      `
    );

    const readiness = await checkCodexReadiness({
      binaryPath: process.execPath,
      binaryArgs: [brokenBinary]
    });

    assert.equal(readiness.available, false);
    assert.equal(readiness.missing, false);
    assert.equal(readiness.binaryPath, process.execPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("classifyCodexSmokeStderr ignores known benign Codex internal warnings only", () => {
  const stderr = [
    "2026-04-08T14:03:05Z  WARN codex_state::runtime: failed to remove legacy logs db file /Users/example/.codex/logs_2.sqlite: device or resource busy (os error 32)",
    "2026-04-08T14:03:06Z  WARN codex_state::runtime: failed to open state db at /Users/example/.codex/state_5.sqlite: migration 21 was previously applied but is missing in the resolved migrations",
    "2026-04-08T14:03:06Z  WARN codex_rollout::state_db: failed to initialize state runtime at /Users/example/.codex: migration 21 was previously applied but is missing in the resolved migrations",
    "2026-04-08T14:03:06Z  WARN codex_rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back",
    "2026-04-08T14:03:06Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at \"/tmp/example\": Os { code: 2, kind: NotFound, message: \"No such file or directory\" }",
    "2026-04-08T14:03:06Z  WARN codex_core::shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell",
    "Reading additional input from stdin...",
    "2026-04-08T14:03:06Z ERROR codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit",
    "2026-04-08T14:03:07Z WARN custom warning"
  ].join("\n");

  const classified = classifyCodexSmokeStderr(stderr);

  assert.equal(classified.ignoredLines.length, 8);
  assert.deepEqual(classified.actionableLines, [
    "2026-04-08T14:03:07Z WARN custom warning"
  ]);
});

test("summarizeCodexSmokeStderr extracts concise actionable root causes", () => {
  assert.equal(
    summarizeCodexSmokeStderr("error: unexpected argument 'exactly' found\n\nUsage: codex exec [OPTIONS] [PROMPT] [COMMAND]"),
    "error: unexpected argument 'exactly' found"
  );
  assert.equal(
    summarizeCodexSmokeStderr("2026-04-17T04:22:49.185023Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 403 Forbidden, url: wss://chatgpt.com/backend-api/codex/responses"),
    "Codex could not open the Responses websocket (403 Forbidden)."
  );
  assert.equal(
    summarizeCodexSmokeStderr([
      "2026-04-17T04:22:49.185023Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 403 Forbidden, url: wss://chatgpt.com/backend-api/codex/responses",
      "2026-04-17T04:22:49.285023Z  WARN codex_core::client: falling back to HTTP"
    ].join("\n")),
    "Codex Responses websocket returned 403 Forbidden, then the CLI fell back to HTTP."
  );
  assert.equal(
    summarizeCodexSmokeStderr("2026-04-17T04:22:49.185023Z WARN codex_core::plugins::startup_sync: startup remote plugin sync failed\nProcess timed out after 120000ms."),
    "Codex smoke command did not exit before the 120000ms timeout."
  );
  assert.equal(
    summarizeCodexSmokeStderr("2026-04-17T04:22:49.185023Z WARN codex_core::plugins::startup_sync: startup remote plugin sync failed"),
    "Codex could not sync plugins from chatgpt.com."
  );
});

test("codexCliMissingMessage explains PATH diagnosis and reinstall fallback", () => {
  const message = codexCliMissingMessage();

  assert.match(message, /not on the current shell PATH yet/i);
  assert.match(message, /global npm prefix/i);
  assert.match(message, /partial install/i);
  assert.match(message, /reinstall Codex, update PATH/i);
});

test("runCodexExec reads summary from the Codex output file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-exec-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  try {
    const harness = await createCodexHarness(
      tempDir,
      "codex-exec.mjs",
      `
        import { writeFile } from "node:fs/promises";

        const args = process.argv.slice(2);
        if (args[0] !== "exec") {
          console.error("unexpected invocation");
          process.exit(1);
        }

        let outputPath = "";
        let prompt = "";
        for (let index = 1; index < args.length; index += 1) {
          const arg = args[index];
          if (arg === "-o" || arg === "-C" || arg === "--sandbox" || arg === "--profile" || arg === "--model") {
            if (arg === "-o") {
              outputPath = args[index + 1] ?? "";
            }
            index += 1;
            continue;
          }
          if (arg === "--json" || arg === "--skip-git-repo-check") {
            continue;
          }
          prompt = arg;
        }

        await writeFile(outputPath, "summary from output file\\n", "utf8");
        console.log(\`stdout for \${prompt}\`);
      `
    );

    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "ship it",
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      outputDir: tempDir,
      sandbox: "workspace-write"
    });

    assert.equal(result.ok, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.summary, "summary from output file");
    assert.match(result.stdout, /stdout for ship it/);
    assert.ok(result.lastMessagePath?.startsWith(tempDir));
  } finally {
    restoreCodexBin(originalBin);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCodexExec marks timeout and returns a timeout summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-timeout-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  try {
    const harness = await createCodexHarness(
      tempDir,
      "codex-timeout.mjs",
      `
        const args = process.argv.slice(2);
        if (args[0] !== "exec") {
          console.error("unexpected invocation");
          process.exit(1);
        }

        await new Promise((resolve) => setTimeout(resolve, 1_000));
        console.log("late output");
      `
    );

    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "wait forever",
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      outputDir: tempDir,
      timeoutMs: 10
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
    assert.match(result.summary, /timed out after 10ms/);
    assert.match(result.stderr, /timed out after 10ms/);
  } finally {
    restoreCodexBin(originalBin);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCodexExec settles timeout even when the child ignores normal termination", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-timeout-grace-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  const originalGrace = process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS;
  try {
    process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS = "20";
    const harness = await createCodexHarness(
      tempDir,
      "codex-ignore-term.mjs",
      `
        const args = process.argv.slice(2);
        if (args[0] !== "exec") {
          process.exit(1);
        }
        process.on("SIGTERM", () => {
          console.error("ignored SIGTERM");
        });
        setInterval(() => {
          process.stdout.write("still running\\n");
        }, 100);
      `
    );

    const startedAt = Date.now();
    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "wait forever",
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      outputDir: tempDir,
      timeoutMs: 10
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
    assert.match(result.stderr, /timed out after 10ms/);
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    restoreCodexBin(originalBin);
    if (originalGrace === undefined) {
      delete process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS;
    } else {
      process.env.HAPPYTG_COMMAND_TIMEOUT_GRACE_MS = originalGrace;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCodexExec caps stdout and stderr while reporting truncation metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-output-cap-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  const originalCap = process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES;
  try {
    process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES = "32";
    const harness = await createCodexHarness(
      tempDir,
      "codex-large-output.mjs",
      `
        const args = process.argv.slice(2);
        if (args[0] !== "exec") {
          process.exit(1);
        }
        process.stdout.write("stdout-" + "x".repeat(80) + "-tail");
        process.stderr.write("stderr-" + "y".repeat(80) + "-tail");
      `
    );

    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "large output",
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      outputDir: tempDir
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, true);
    assert.equal(result.outputRetentionBytes, 32);
    assert.ok((result.stdoutBytes ?? 0) > 32);
    assert.ok((result.stderrBytes ?? 0) > 32);
    assert.ok(Buffer.byteLength(result.stdout) <= 32);
    assert.ok(Buffer.byteLength(result.stderr) <= 32);
    assert.match(result.stdout, /-tail$/);
    assert.match(result.stderr, /-tail$/);
  } finally {
    restoreCodexBin(originalBin);
    if (originalCap === undefined) {
      delete process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES;
    } else {
      process.env.HAPPYTG_COMMAND_OUTPUT_MAX_BYTES = originalCap;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCodexExec returns actionable guidance when Codex CLI is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-missing-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  try {
    process.env.CODEX_CLI_BIN = path.join(tempDir, "missing-codex");

    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "ship it",
      outputDir: tempDir
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 127);
    assert.equal(result.summary, codexCliMissingMessage());
    assert.match(result.stderr, /missing-codex/);
  } finally {
    restoreCodexBin(originalBin);
    await rm(tempDir, { recursive: true, force: true });
  }
});
