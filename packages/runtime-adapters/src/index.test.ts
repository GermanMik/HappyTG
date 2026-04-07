import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { checkCodexReadiness, runCodexExec } from "./index.js";

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
  await chmod(filePath, 0o755);
}

test("checkCodexReadiness reports available Codex and captures smoke warnings", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-ready-"));
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
        '  echo "migration warning" 1>&2',
        "  exit 0",
        "fi",
        'echo "unexpected invocation" 1>&2',
        "exit 1"
      ].join("\n")
    );

    const readiness = await checkCodexReadiness({
      binaryPath,
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

test("runCodexExec reads summary from the Codex output file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-exec-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  try {
    const binaryPath = path.join(tempDir, "codex");
    await writeExecutable(
      binaryPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "exec" ]; then',
        '  OUTPUT=""',
        '  while [ "$#" -gt 0 ]; do',
        '    if [ "$1" = "-o" ]; then',
        '      OUTPUT="$2"',
        "      shift 2",
        "      continue",
        "    fi",
        '    if [ "$1" = "-C" ] || [ "$1" = "--sandbox" ] || [ "$1" = "--profile" ] || [ "$1" = "--model" ]; then',
        "      shift 2",
        "      continue",
        "    fi",
        '    if [ "$1" = "--json" ] || [ "$1" = "--skip-git-repo-check" ]; then',
        "      shift 1",
        "      continue",
        "    fi",
        '    PROMPT="$1"',
        "    shift 1",
        "  done",
        '  printf "summary from output file\\n" > "$OUTPUT"',
        '  printf "stdout for %s\\n" "$PROMPT"',
        "  exit 0",
        "fi",
        'echo "unexpected invocation" 1>&2',
        "exit 1"
      ].join("\n")
    );

    process.env.CODEX_CLI_BIN = binaryPath;
    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "ship it",
      outputDir: tempDir,
      sandbox: "workspace-write"
    });

    assert.equal(result.ok, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.summary, "summary from output file");
    assert.match(result.stdout, /stdout for ship it/);
    assert.ok(result.lastMessagePath?.startsWith(tempDir));
  } finally {
    if (originalBin === undefined) {
      delete process.env.CODEX_CLI_BIN;
    } else {
      process.env.CODEX_CLI_BIN = originalBin;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCodexExec marks timeout and returns a timeout summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-timeout-"));
  const originalBin = process.env.CODEX_CLI_BIN;
  try {
    const binaryPath = path.join(tempDir, "codex");
    await writeExecutable(
      binaryPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "exec" ]; then',
        "  sleep 1",
        '  echo "late output"',
        "  exit 0",
        "fi",
        'echo "unexpected invocation" 1>&2',
        "exit 1"
      ].join("\n")
    );

    process.env.CODEX_CLI_BIN = binaryPath;
    const result = await runCodexExec({
      cwd: tempDir,
      prompt: "wait forever",
      outputDir: tempDir,
      timeoutMs: 10
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
    assert.match(result.summary, /timed out after 10ms/);
    assert.match(result.stderr, /timed out after 10ms/);
  } finally {
    if (originalBin === undefined) {
      delete process.env.CODEX_CLI_BIN;
    } else {
      process.env.CODEX_CLI_BIN = originalBin;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
