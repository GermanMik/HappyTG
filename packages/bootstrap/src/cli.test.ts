import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { codexCliMissingMessage } from "../../runtime-adapters/src/index.js";
import { executeHappyTG, parseHappyTGArgs, renderText } from "./cli.js";

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
  assert.equal(parsed.options.repoDir, "/tmp/happytg-cli/HappyTG");
  assert.equal(parsed.options.telegramBotToken, "123456:abcdefghijklmnopqrstuvwx");
  assert.deepEqual(parsed.options.telegramAllowedUserIds, ["1001", "1002"]);
  assert.equal(parsed.options.telegramHomeChannel, "@home");
  assert.equal(parsed.options.backgroundMode, "manual");
  assert.deepEqual(parsed.options.postChecks, ["setup", "doctor"]);
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
      codex: {
        binaryPath: "/tmp/codex"
      }
    },
    createdAt: "2026-04-08T00:00:00.000Z"
  });

  assert.match(output, /HappyTG setup \[WARN\]/);
  assert.match(output, /Summary: 1 error found\./);
  assert.match(output, /Preflight:/);
  assert.match(output, /First start:/);
  assert.match(output, /Diagnostics:/);
  assert.match(output, /pnpm happytg setup --json/);
  assert.doesNotMatch(output, /\/tmp\/codex/);
});

test("renderText returns a compact install summary", () => {
  const output = renderText({
    kind: "install",
    status: "warn",
    interactive: false,
    repo: {
      mode: "current",
      path: "/tmp/HappyTG",
      sync: "reused",
      dirtyStrategy: "keep"
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
    postChecks: [],
    steps: [],
    nextSteps: [
      "pnpm dev",
      "pnpm daemon:pair"
    ],
    warnings: [
      "Docker Desktop was skipped."
    ],
    reportJson: {}
  });

  assert.match(output, /HappyTG install \[WARN\]/);
  assert.match(output, /@happytg_bot/);
  assert.match(output, /Docker Desktop was skipped/);
  assert.match(output, /pnpm daemon:pair/);
});
