import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkCodexReadiness, classifyCodexSmokeStderr, codexCliMissingMessage, runCodexExec } from "./index.js";

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

test("checkCodexReadiness resolves a Windows-style codex.cmd shim from Path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-win-shim-"));
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
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkCodexReadiness resolves a Windows-style codex.cmd shim from lowercase path and pathext", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-win-shim-case-"));
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
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkCodexReadiness keeps Windows shim resolution working when PATH/Path and PATHEXT/pathext are duplicated", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-win-shim-dupe-"));
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
    "2026-04-08T14:03:06Z  WARN codex_state::runtime: failed to open state db at /Users/example/.codex/state_5.sqlite: migration 21 was previously applied but is missing in the resolved migrations",
    "2026-04-08T14:03:06Z  WARN codex_core::state_db: failed to initialize state runtime at /Users/example/.codex: migration 21 was previously applied but is missing in the resolved migrations",
    "2026-04-08T14:03:06Z  WARN codex_core::rollout::list: state db discrepancy during find_thread_path_by_id_str_in_subdir: falling_back",
    "2026-04-08T14:03:06Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at \"/tmp/example\": Os { code: 2, kind: NotFound, message: \"No such file or directory\" }",
    "2026-04-08T14:03:06Z ERROR codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit",
    "2026-04-08T14:03:07Z WARN custom warning"
  ].join("\n");

  const classified = classifyCodexSmokeStderr(stderr);

  assert.equal(classified.ignoredLines.length, 5);
  assert.deepEqual(classified.actionableLines, [
    "2026-04-08T14:03:07Z WARN custom warning"
  ]);
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
