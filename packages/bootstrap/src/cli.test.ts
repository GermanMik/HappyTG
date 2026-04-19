import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { codexCliMissingMessage } from "../../runtime-adapters/src/index.js";
import { CliUsageError, executeHappyTG, parseHappyTGArgs, renderText } from "./cli.js";
import type { InstallResult } from "./install/types.js";

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

test("parseHappyTGArgs maps install flags into the installer request", () => {
  const parsed = parseHappyTGArgs([
    "install",
    "--non-interactive",
    "--repo-mode",
    "current",
    "--repo-dir",
    "./HappyTG",
    "--telegram-bot-token",
    "123456:abcdefghijklmnopqrstuvwx",
    "--allowed-user",
    "1001",
    "--allowed-user",
    "1002",
    "--home-channel",
    "@home",
    "--background",
    "manual",
    "--post-check",
    "setup",
    "--post-check",
    "doctor",
    "--json"
  ], "/tmp/happytg-cli");

  assert.equal(parsed.kind, "install");
  if (parsed.kind !== "install") {
    return;
  }

  assert.equal(parsed.json, true);
  assert.equal(parsed.options.nonInteractive, true);
  assert.equal(parsed.options.repoMode, "current");
  assert.equal(parsed.options.repoDir, path.resolve("/tmp/happytg-cli", "HappyTG"));
  assert.equal(parsed.options.telegramBotToken, "123456:abcdefghijklmnopqrstuvwx");
  assert.deepEqual(parsed.options.telegramAllowedUserIds, ["1001", "1002"]);
  assert.equal(parsed.options.telegramHomeChannel, "@home");
  assert.equal(parsed.options.backgroundMode, "manual");
  assert.deepEqual(parsed.options.postChecks, ["setup", "doctor"]);
});

test("parseHappyTGArgs uses CliUsageError for invalid CLI surfaces", () => {
  assert.throws(() => parseHappyTGArgs(["bogus-command"]), CliUsageError);
  assert.throws(() => parseHappyTGArgs(["task", "bogus"]), CliUsageError);
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

test("executeHappyTG returns a structured install failure when installer throws before its internal runtime boundary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-cli-install-failure-"));

  try {
    const result = await executeHappyTG([
      "install",
      "--json",
      "--non-interactive",
      "--bootstrap-repo-root",
      tempDir,
      "--launch-cwd",
      tempDir,
      "--repo-dir",
      path.join(tempDir, "HappyTG"),
      "--telegram-bot-token",
      "123456:abcdefghijklmnopqrstuvwx"
    ], tempDir) as InstallResult;

    assert.equal(result.kind, "install");
    assert.equal(result.status, "fail");
    assert.match(result.error?.lastError ?? "", /installers\.yaml/);
    assert.doesNotMatch(JSON.stringify(result), /Usage:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("executeHappyTG delegates install requests through the CLI wrapper without changing the installer result contract", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-cli-install-wrapper-"));

  try {
    let receivedOptions: InstallResult["reportJson"] | undefined;
    let bootstrapCheckCalls = 0;
    const expected: InstallResult = {
      kind: "install",
      status: "warn",
      outcome: "success-with-warnings",
      interactive: true,
      tuiHandled: true,
      repo: {
        mode: "current",
        path: path.join(tempDir, "HappyTG"),
        sync: "reused",
        dirtyStrategy: "keep",
        source: "local",
        repoUrl: "https://github.com/GermanMik/HappyTG.git",
        attempts: 0,
        fallbackUsed: false
      },
      environment: {
        platform: {
          platform: "win32",
          arch: "x64",
          shell: "powershell.exe",
          linuxFamily: "unknown",
          systemPackageManager: "winget",
          repoPackageManager: "pnpm",
          isInteractiveTerminal: true
        },
        dependencies: []
      },
      telegram: {
        configured: true,
        allowedUserIds: ["1001"]
      },
      background: {
        mode: "manual",
        status: "manual",
        detail: "After pairing, start the daemon with `pnpm dev:daemon`."
      },
      finalization: {
        items: [
          {
            id: "request-pair-code",
            kind: "manual",
            message: "If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command to @happytg_bot."
          }
        ]
      },
      postChecks: [],
      steps: [],
      nextSteps: ["If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command to @happytg_bot."],
      warnings: [],
      reportJson: {
        marker: "install-wrapper-pass-through"
      }
    };

    const result = await executeHappyTG([
      "install",
      "--repo-mode",
      "current",
      "--repo-dir",
      "./HappyTG",
      "--telegram-bot-token",
      "123456:abcdefghijklmnopqrstuvwx",
      "--allowed-user",
      "1001",
      "--background",
      "manual",
      "--post-check",
      "setup"
    ], tempDir, {
      runBootstrapCommandImpl: async (command) => {
        bootstrapCheckCalls += 1;
        return {
          id: `btr_${command}`,
          hostFingerprint: "fp",
          command,
          status: "pass",
          profileRecommendation: "recommended",
          findings: [],
          planPreview: [],
          reportJson: {},
          createdAt: "2026-04-19T00:00:00.000Z"
        };
      },
      runHappyTGInstallImpl: async (options, input) => {
        receivedOptions = {
          repoMode: options.repoMode,
          repoDir: options.repoDir,
          backgroundMode: options.backgroundMode,
          postChecks: options.postChecks,
          telegramAllowedUserIds: options.telegramAllowedUserIds
        };
        await input?.runBootstrapCheck?.("setup", {
          cwd: options.repoDir,
          env: process.env,
          platform: process.platform
        });
        return expected;
      }
    });

    assert.deepEqual(result, expected);
    assert.deepEqual(receivedOptions, {
      repoMode: "current",
      repoDir: path.resolve(tempDir, "HappyTG"),
      backgroundMode: "manual",
      postChecks: ["setup"],
      telegramAllowedUserIds: ["1001"]
    });
    assert.equal(bootstrapCheckCalls, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renderText returns a compact bootstrap summary with preflight and diagnostics hints", () => {
  const output = renderText({
    id: "btr_1",
    hostFingerprint: "fp",
    command: "setup",
    status: "warn",
    profileRecommendation: "recommended",
    findings: [
      {
        code: "CODEX_MISSING",
        severity: "error",
        message: codexCliMissingMessage()
      }
    ],
    planPreview: [
      "Install Codex CLI and verify `codex --version`."
    ],
    reportJson: {
      preflight: [
        "Env: .env found",
        "Codex: codex-cli 0.115.0"
      ],
      onboarding: {
        items: [
          {
            id: "codex-install",
            kind: "blocked",
            message: "Install Codex CLI and verify `codex --version`."
          }
        ]
      },
      codex: {
        binaryPath: "/tmp/codex"
      }
    },
    createdAt: "2026-04-08T00:00:00.000Z"
  });

  assert.match(output, /HappyTG setup \[WARN\]/);
  assert.match(output, /Summary: 1 error found\./);
  assert.match(output, /Preflight:/);
  assert.match(output, /Blocked:/);
  assert.match(output, /Diagnostics:/);
  assert.match(output, /pnpm happytg setup --json/);
  assert.doesNotMatch(output, /\/tmp\/codex/);
});

test("renderText returns a compact install summary with structured finalization sections", () => {
  const output = renderText({
    kind: "install",
    status: "warn",
    outcome: "success-with-warnings",
    interactive: false,
    tuiHandled: false,
    repo: {
      mode: "current",
      path: "/tmp/HappyTG",
      sync: "reused",
      dirtyStrategy: "keep",
      source: "local",
      repoUrl: "https://github.com/GermanMik/HappyTG.git",
      attempts: 0,
      fallbackUsed: false
    },
    environment: {
      platform: {
        platform: "darwin",
        arch: "arm64",
        shell: "/bin/zsh",
        linuxFamily: "unknown",
        systemPackageManager: "brew",
        repoPackageManager: "pnpm",
        isInteractiveTerminal: false
      },
      dependencies: []
    },
    telegram: {
      configured: true,
      allowedUserIds: ["1001"],
      bot: {
        ok: true,
        username: "happytg_bot"
      }
    },
    background: {
      mode: "manual",
      status: "manual",
      detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
    },
    finalization: {
      items: [
        {
          id: "start-repo-services",
          kind: "manual",
          message: "Start repo services: `pnpm dev`."
        },
        {
          id: "request-pair-code",
          kind: "manual",
          message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
        },
        {
          id: "complete-pairing",
          kind: "manual",
          message: "Send `/pair ABC123` to @happytg_bot."
        },
        {
          id: "miniapp-port-conflict",
          kind: "conflict",
          message: "Mini App port 3001 is occupied by another process.",
          solutions: [
            "Reuse the running service if it is yours.",
            "Or set `HAPPYTG_MINIAPP_PORT=3006` before starting the mini app."
          ]
        }
      ]
    },
    postChecks: [],
    steps: [],
    nextSteps: [],
    warnings: [
      "Docker Desktop was skipped."
    ],
    reportJson: {}
  });

  assert.match(output, /HappyTG install \[WARN\]/);
  assert.match(output, /Result: install flow is complete with warnings\./);
  assert.match(output, /@happytg_bot/);
  assert.match(output, /Requires user:/);
  assert.match(output, /Docker Desktop was skipped/);
  assert.match(output, /pnpm daemon:pair/);
  assert.match(output, /Mini App port 3001 is occupied by another process/);
  assert.match(output, /Reuse the running service if it is yours/);
  assert.match(output, /HAPPYTG_MINIAPP_PORT=3006/);
  assert.doesNotMatch(output, /Next steps:/);
});

test("renderText keeps warning-only follow-up separate from manual actions in install summaries", () => {
  const npmBinDir = "C:\\Users\\tikta\\AppData\\Roaming\\npm";
  const wrapperPath = `${npmBinDir}\\codex.cmd`;
  const pathWarning = `Codex CLI worked through the npm wrapper at \`${wrapperPath}\`, but \`${npmBinDir}\` is not on the current shell PATH yet. Update PATH or restart the shell so plain \`codex\` resolves directly.`;
  const pathNextStep = `Add \`${npmBinDir}\` to PATH, restart the shell, then verify \`codex --version\`.`;
  const telegramWarning = "Telegram API getMe network request failed: fetch failed. Existing bot username @Gerta_homebot was kept.";
  const output = renderText({
    kind: "install",
    status: "warn",
    outcome: "success-with-warnings",
    interactive: false,
    tuiHandled: false,
    repo: {
      mode: "current",
      path: "C:\\Develop\\Projects\\HappyTG",
      sync: "reused",
      dirtyStrategy: "keep",
      source: "local",
      repoUrl: "https://github.com/GermanMik/HappyTG.git",
      attempts: 0,
      fallbackUsed: false
    },
    environment: {
      platform: {
        platform: "win32",
        arch: "x64",
        shell: "C:\\Windows\\System32\\cmd.exe",
        linuxFamily: "unknown",
        systemPackageManager: "winget",
        repoPackageManager: "pnpm",
        isInteractiveTerminal: false
      },
      dependencies: []
    },
    telegram: {
      configured: true,
      allowedUserIds: ["1001"],
      bot: {
        ok: false,
        username: "Gerta_homebot"
      }
    },
    background: {
      mode: "manual",
      status: "manual",
      detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
    },
    finalization: {
      items: [
        {
          id: "start-repo-services",
          kind: "manual",
          message: "Start repo services: `pnpm dev`."
        },
        {
          id: "codex-path-pending",
          kind: "warning",
          message: pathNextStep
        }
      ]
    },
    postChecks: [],
    steps: [],
    nextSteps: [],
    warnings: [
      telegramWarning,
      pathWarning
    ],
    reportJson: {}
  });

  assert.match(output, /HappyTG install \[WARN\]/);
  assert.match(output, /Result: install flow is complete with warnings\./);
  assert.match(output, /Warnings: 3/);
  assert.match(output, /Requires user:/);
  assert.match(output, /Telegram API getMe network request failed: fetch failed/);
  assert.match(output, new RegExp(npmBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(output, /verify `codex --version`/);
  assert.doesNotMatch(output, /Next steps:/);
});

test("renderText explains recoverable installer failures without claiming completion", () => {
  const output = renderText({
    kind: "install",
    status: "fail",
    outcome: "recoverable-failure",
    interactive: false,
    tuiHandled: false,
    repo: {
      mode: "current",
      path: "/tmp/HappyTG",
      sync: "reused",
      dirtyStrategy: "keep",
      source: "local",
      repoUrl: "https://github.com/GermanMik/HappyTG.git",
      attempts: 0,
      fallbackUsed: false
    },
    environment: {
      platform: {
        platform: "darwin",
        arch: "arm64",
        shell: "/bin/zsh",
        linuxFamily: "unknown",
        systemPackageManager: "brew",
        repoPackageManager: "pnpm",
        isInteractiveTerminal: false
      },
      dependencies: []
    },
    telegram: {
      configured: true,
      allowedUserIds: ["1001"]
    },
    background: {
      mode: "manual",
      status: "manual",
      detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
    },
    postChecks: [],
    steps: [],
    nextSteps: [
      "pnpm dev",
      "pnpm daemon:pair"
    ],
    warnings: [
      "Telegram bot lookup: fetch failed"
    ],
    error: {
      code: "installer_partial_failure",
      message: "1 installer step still needs attention.",
      lastError: "Run verify failed.",
      retryable: false,
      suggestedAction: "Resolve the reported failed steps, then rerun the installer."
    },
    reportJson: {}
  });

  assert.match(output, /HappyTG install \[FAIL\]/);
  assert.match(output, /Result: install needs follow-up before it is fully ready\./);
  assert.doesNotMatch(output, /Install flow is complete\./);
});
