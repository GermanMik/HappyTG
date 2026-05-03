import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkCodexReadiness,
  classifyActionKind,
  classifyCodexSmokeStderr,
  CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE,
  CodexDesktopStateAdapter,
  codexCliMissingMessage,
  createCodexDesktopAppServerControlContract,
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
        const normalized = [...args];
        const cdIndex = normalized.indexOf("-C");
        if (cdIndex !== -1) {
          normalized.splice(cdIndex, 2);
        }
        const expected = ["exec", "--skip-git-repo-check", "--json", ${JSON.stringify(expectedPrompt)}];
        const matches = normalized.length === expected.length && normalized.every((value, index) => value === expected[index]);
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
  assert.equal(classifyActionKind("codex_desktop_stop"), "shell_network_system_sensitive");

  assert.equal(toolExecutionPolicyForAction("workspace_read").defaultPolicy, "allow");
  assert.equal(toolExecutionPolicyForAction("workspace_write").defaultPolicy, "require_approval");
  assert.equal(toolExecutionPolicyForAction("git_push").defaultPolicy, "deny");
  assert.equal(toolExecutionPolicyForAction("codex_desktop_resume").executionLane, "serial_mutation");

  const batches = planToolExecutionBatches([
    { id: "read-1", actionKind: "read_status" },
    { id: "read-2", actionKind: "workspace_read" },
    { id: "desktop-resume", actionKind: "codex_desktop_resume" },
    { id: "desktop-stop", actionKind: "codex_desktop_stop" },
    { id: "write-1", actionKind: "workspace_write" },
    { id: "verify-1", actionKind: "verification_run" },
    { id: "desktop-new-task", actionKind: "codex_desktop_new_task" },
    { id: "push-1", actionKind: "git_push" }
  ]);

  assert.deepEqual(batches.map((batch) => `${batch.mode}:${batch.calls.map((call) => call.id).join(",")}`), [
    "parallel:read-1,read-2",
    "serial:desktop-resume",
    "serial:desktop-stop",
    "serial:write-1",
    "parallel:verify-1",
    "serial:desktop-new-task",
    "serial:push-1"
  ]);
});

test("Codex Desktop adapter parses projects from global state without private payloads", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "happytg-codex-desktop-global-"));
  try {
    await writeFile(
      path.join(codexHome, ".codex-global-state.json"),
      JSON.stringify({
        "electron-saved-workspace-roots": ["C:/Develop/Projects/HappyTG"],
        "active-workspace-roots": ["C:/Develop/Projects/HappyTG"],
        "thread-workspace-root-hints": {
          "session-1": "C:/Develop/Projects/HappyTG"
        },
        "private-token-like-field": "SECRET_TOKEN_SHOULD_NOT_APPEAR"
      }),
      "utf8"
    );

    const adapter = new CodexDesktopStateAdapter({ codexHome });
    const projects = await adapter.listProjects();

    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.label, "HappyTG");
    assert.equal(projects[0]?.source, "codex-desktop");
    assert.equal(projects[0]?.active, true);
    assert.doesNotMatch(JSON.stringify(projects), /SECRET_TOKEN_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("Codex Desktop adapter parses session_index and session files as sanitized sessions", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "happytg-codex-desktop-sessions-"));
  try {
    const sessionDir = path.join(codexHome, "sessions", "2026", "04", "28");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(codexHome, ".codex-global-state.json"),
      JSON.stringify({
        "electron-saved-workspace-roots": ["C:/Develop/Projects/HappyTG"],
        "thread-workspace-root-hints": {
          "session-1": "C:/Develop/Projects/HappyTG"
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-1", thread_name: "Desktop release check", updated_at: "2026-04-28T08:00:00.000Z" })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(sessionDir, "session-1.jsonl"),
      [
        JSON.stringify({ timestamp: "2026-04-28T09:00:00.000Z", payload: { id: "session-1", cwd: "C:/Develop/Projects/HappyTG", role: "user", content: "RAW_PROMPT_SECRET token=abc" } }),
        JSON.stringify({ timestamp: "2026-04-28T09:01:00.000Z", payload: { id: "session-1", role: "assistant", content: "Safe desktop answer" } })
      ].join("\n") + "\n",
      "utf8"
    );

    const adapter = new CodexDesktopStateAdapter({ codexHome });
    const sessions = await adapter.listSessions();
    const detail = await adapter.getSessionDetail("session-1");

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "session-1");
    assert.equal(sessions[0]?.title, "Desktop release check");
    assert.equal(sessions[0]?.source, "codex-desktop");
    assert.equal(sessions[0]?.status, "recent");
    assert.equal(sessions[0]?.canResume, false);
    assert.equal(sessions[0]?.canStop, false);
    assert.match(sessions[0]?.unsupportedReason ?? "", /unsupported/i);
    assert.equal(sessions[0]?.unsupportedReasonCode, CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE);
    assert.doesNotMatch(JSON.stringify(sessions), /RAW_PROMPT_SECRET/);
    assert.equal(detail?.session.source, "codex-desktop");
    assert.equal(detail?.history.length, 2);
    assert.equal(detail?.history[0]?.source, "codex-desktop");
    assert.equal(detail?.history[0]?.role, "user");
    assert.match(detail?.history[1]?.summary ?? "", /Safe desktop answer/);
    assert.doesNotMatch(JSON.stringify(detail), /RAW_PROMPT_SECRET/);
    assert.doesNotMatch(JSON.stringify(detail), /token=abc/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("Codex Desktop adapter controls sessions through Codex app-server JSON-RPC", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-codex-desktop-control-"));
  let adapter: CodexDesktopStateAdapter | undefined;
  try {
    const codexHome = path.join(tempDir, "codex-home");
    const sessionDir = path.join(codexHome, "sessions", "2026", "05", "01");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(codexHome, ".codex-global-state.json"),
      JSON.stringify({
        "electron-saved-workspace-roots": ["C:/Develop/Projects/HappyTG"],
        "thread-workspace-root-hints": {
          "session-1": "C:/Develop/Projects/HappyTG"
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-1", thread_name: "Desktop app-server control", updated_at: "2026-05-01T08:00:00.000Z" })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(sessionDir, "session-1.jsonl"),
      `${JSON.stringify({ timestamp: "2026-05-01T09:00:00.000Z", payload: { id: "session-1", cwd: "C:/Develop/Projects/HappyTG" } })}\n`,
      "utf8"
    );

    const harness = await createCodexHarness(
      tempDir,
      "app-server-harness.mjs",
      `
        import readline from "node:readline";
        const rl = readline.createInterface({ input: process.stdin });
        function thread(id, status = "idle") {
          return {
            id,
            preview: id === "new-thread" ? "Run Desktop task" : "Desktop app-server control",
            name: id === "new-thread" ? "Desktop task" : "Desktop app-server control",
            cwd: "C:/Develop/Projects/HappyTG",
            updatedAt: 1777626000,
            status: { type: status },
            turns: []
          };
        }
        function send(id, result) {
          process.stdout.write(JSON.stringify({ id, result }) + "\\n");
        }
        rl.on("line", (line) => {
          const message = JSON.parse(line);
          if (!message.id) return;
          switch (message.method) {
            case "initialize":
              send(message.id, { userAgent: "happytg-test", codexHome: ${JSON.stringify(codexHome)}, platformFamily: "windows", platformOs: "windows" });
              break;
            case "thread/list":
              send(message.id, { data: [thread("session-1")], nextCursor: null, backwardsCursor: null });
              break;
            case "thread/resume":
              send(message.id, { thread: thread(message.params.threadId) });
              break;
            case "thread/turns/list":
              send(message.id, { data: [{ id: "turn-running", status: "inProgress" }], nextCursor: null, backwardsCursor: null });
              break;
            case "turn/interrupt":
              send(message.id, {});
              break;
            case "thread/start":
              send(message.id, { thread: thread("new-thread", "active") });
              break;
            case "turn/start":
              send(message.id, { turn: { id: "turn-new", status: "inProgress" } });
              break;
            default:
              process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "unexpected " + message.method } }) + "\\n");
          }
        });
      `
    );

    adapter = new CodexDesktopStateAdapter({
      codexHome,
      controlContract: createCodexDesktopAppServerControlContract({
        env: process.env,
        codexHome,
        command: harness.binaryPath,
        args: harness.binaryArgs
      })
    });
    const sessions = await adapter.listSessions();

    assert.equal(sessions[0]?.canResume, true);
    assert.equal(sessions[0]?.canStop, true);
    assert.equal(sessions[0]?.canCreateTask, true);

    const resumed = await adapter.resumeSession(sessions[0]!);
    const stopped = await adapter.stopSession(sessions[0]!);
    const created = await adapter.createTask({
      userId: "usr_1",
      projectPath: "C:/Develop/Projects/HappyTG",
      prompt: "Run Desktop task",
      title: "Desktop task"
    });

    assert.equal(resumed.action, "resume");
    assert.equal(stopped.action, "stop");
    assert.equal(created.action, "new-task");
    assert.equal(created.task?.id, "new-thread");
    assert.equal(created.task?.status, "running");
  } finally {
    adapter?.dispose();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Codex Desktop default adapter keeps experimental app-server control unsupported", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-codex-desktop-default-unsupported-"));
  try {
    const codexHome = path.join(tempDir, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      path.join(codexHome, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-1", thread_name: "Desktop default unsupported", updated_at: "2026-05-03T08:00:00.000Z" })}\n`,
      "utf8"
    );

    const adapter = new CodexDesktopStateAdapter({
      codexHome,
      env: {
        ...process.env,
        HAPPYTG_CODEX_DESKTOP_CONTROL: "app-server"
      }
    });
    const sessions = await adapter.listSessions();

    assert.equal(adapter.canCreateTask(), false);
    assert.equal(adapter.controlUnsupportedReasonCode(), CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE);
    assert.equal(sessions[0]?.canResume, false);
    assert.equal(sessions[0]?.canStop, false);
    assert.equal(sessions[0]?.canCreateTask, false);
    assert.equal(sessions[0]?.unsupportedReasonCode, CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE);
    assert.match(sessions[0]?.unsupportedReason ?? "", /experimental/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Codex Desktop adapter tolerates missing and corrupt state", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "happytg-codex-desktop-corrupt-"));
  try {
    const sessionDir = path.join(codexHome, "sessions", "2026");
    const archivedDir = path.join(codexHome, "archived_sessions", "2026");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });
    await writeFile(path.join(codexHome, ".codex-global-state.json"), "{not json", "utf8");
    await writeFile(path.join(codexHome, "session_index.jsonl"), "{\"id\":\"ok-session\",\"thread_name\":\"Recovered\"}\n{bad json\n", "utf8");
    await writeFile(path.join(sessionDir, "unknown-session.jsonl"), "{bad json\n", "utf8");
    await writeFile(path.join(archivedDir, "archived-session.jsonl"), "{bad json\n", "utf8");
    await writeFile(path.join(codexHome, "auth.json"), "{\"token\":\"AUTH_SECRET_SHOULD_NOT_APPEAR\"}", "utf8");

    const adapter = new CodexDesktopStateAdapter({ codexHome });
    const projects = await adapter.listProjects();
    const sessions = await adapter.listSessions();

    assert.deepEqual(projects, []);
    assert.equal(sessions.some((session) => session.id === "ok-session"), true);
    assert.equal(sessions.some((session) => session.status === "unknown"), true);
    assert.doesNotMatch(JSON.stringify(sessions), /AUTH_SECRET_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
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

test("checkCodexReadiness runs smoke from a neutral cwd when provided", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "happytg-runtime-smoke-cwd-"));
  try {
    const repoDir = path.join(tempRoot, "repo");
    const smokeDir = path.join(tempRoot, "smoke");
    await mkdir(repoDir, { recursive: true });
    await mkdir(smokeDir, { recursive: true });
    const harness = await createCodexHarness(
      tempRoot,
      "codex-smoke-cwd-harness.mjs",
      `
        import path from "node:path";
        const expectedSmokeCwd = path.resolve(${JSON.stringify(smokeDir)});
        const args = process.argv.slice(2);
        if (args[0] === "--version") {
          console.log("codex test 1.0");
          process.exit(0);
        }
        if (args[0] === "exec") {
          const cdIndex = args.indexOf("-C");
          if (cdIndex === -1 || path.resolve(args[cdIndex + 1] ?? "") !== expectedSmokeCwd) {
            console.error(\`missing neutral smoke cwd: \${JSON.stringify(args)}\`);
            process.exit(1);
          }
          if (path.resolve(process.cwd()) !== expectedSmokeCwd) {
            console.error(\`unexpected process cwd: \${process.cwd()}\`);
            process.exit(1);
          }
          console.log('{"type":"message","text":"OK"}');
          process.exit(0);
        }
        console.error("unexpected invocation");
        process.exit(1);
      `
    );
    const configPath = path.join(tempRoot, "config.toml");
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const readiness = await checkCodexReadiness({
      binaryPath: harness.binaryPath,
      binaryArgs: harness.binaryArgs,
      configPath,
      cwd: repoDir,
      smokeCwd: smokeDir
    });

    assert.equal(readiness.available, true);
    assert.equal(readiness.smokeOk, true);
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
    "2026-05-03T13:52:18Z WARN codex_analytics::client: failed to send events request: error sending request for url (https://chatgpt.com/backend-api/codex/analytics-events/events)",
    "2026-05-03T13:57:41Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Client(HttpRequest(HttpRequest(\"http/request failed: error sending request for url (https://chatgpt.com/backend-api/wham/apps)\")))",
    "2026-05-03T14:03:08Z ERROR codex_core::tools::router: error=`\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'memory context --project'` rejected: blocked by policy",
    "2026-05-03T14:07:22Z ERROR codex_core::tools::router: error=`\"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe\" -Command 'memory search \"OK exact output\"'` rejected: blocked by policy",
    "<!DOCTYPE html>",
    "<head>",
    "width=\"41\"",
    "<script>(function(){window._cf_chl_opt = {cRay: 'test'};}());</script>",
    "</html>",
    "2026-04-08T14:03:07Z WARN custom warning"
  ].join("\n");

  const classified = classifyCodexSmokeStderr(stderr);

  assert.equal(classified.ignoredLines.length, 17);
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
    summarizeCodexSmokeStderr([
      "2026-04-17T04:22:49.185023Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 403 Forbidden, url: wss://chatgpt.com/backend-api/codex/responses",
      "2026-04-17T04:22:49.285023Z  WARN codex_core::client: falling back to HTTP",
      "{\"type\":\"error\",\"message\":\"{\\\"detail\\\":\\\"The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.\\\"}\"}"
    ].join("\n")),
    "Codex CLI is too old for the configured gpt-5.5 model. Upgrade Codex or select a model supported by this CLI."
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
