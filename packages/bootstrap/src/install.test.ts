import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runCommand } from "./install/commands.js";
import { mergeEnvTemplate, writeMergedEnvFile } from "./install/env.js";
import { detectLinuxFamily } from "./install/platform.js";
import { defaultDirtyWorktreeStrategy, detectRepoModeChoices, inspectRepo } from "./install/repo.js";
import { fetchTelegramBotIdentity } from "./install/telegram.js";
import { renderRepoModeScreen, renderTelegramScreen, renderWelcomeScreen, waitForEnter } from "./install/tui.js";

async function git(args: string[], cwd: string): Promise<void> {
  const result = await runCommand({
    command: "git",
    args,
    cwd
  });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
}

test("detectLinuxFamily classifies Debian and Fedora os-release content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-os-release-"));
  try {
    const debianFile = path.join(tempDir, "debian");
    const fedoraFile = path.join(tempDir, "fedora");
    await Promise.all([
      writeFile(debianFile, 'ID=ubuntu\nID_LIKE="debian"\n', "utf8"),
      writeFile(fedoraFile, 'ID=fedora\nID_LIKE="fedora"\n', "utf8")
    ]);

    assert.equal(await detectLinuxFamily("linux", debianFile), "debian");
    assert.equal(await detectLinuxFamily("linux", fedoraFile), "fedora");
    assert.equal(await detectLinuxFamily("darwin", debianFile), "unknown");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectRepoModeChoices distinguishes current checkout, update path, and fresh clone path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-repo-choices-"));
  try {
    const currentRepo = path.join(tempDir, "current");
    const updateRepo = path.join(tempDir, "update");
    const cloneTarget = path.join(tempDir, "clone-target");
    await Promise.all([
      mkdir(currentRepo, { recursive: true }),
      mkdir(updateRepo, { recursive: true })
    ]);

    await git(["init"], currentRepo);
    await git(["config", "user.email", "bot@example.com"], currentRepo);
    await git(["config", "user.name", "HappyTG Bot"], currentRepo);
    await writeFile(path.join(currentRepo, "README.md"), "current\n", "utf8");
    await git(["add", "."], currentRepo);
    await git(["commit", "-m", "init"], currentRepo);

    await git(["init"], updateRepo);
    await git(["config", "user.email", "bot@example.com"], updateRepo);
    await git(["config", "user.name", "HappyTG Bot"], updateRepo);
    await writeFile(path.join(updateRepo, "README.md"), "update\n", "utf8");
    await git(["add", "."], updateRepo);
    await git(["commit", "-m", "init"], updateRepo);

    const detected = await detectRepoModeChoices({
      launchCwd: currentRepo,
      repoDir: updateRepo,
      bootstrapRepoRoot: cloneTarget
    });

    assert.equal(detected.currentInspection.isRepo, true);
    assert.equal(detected.updateInspection.isRepo, true);
    assert.equal(detected.choices.find((choice) => choice.mode === "current")?.available, true);
    assert.equal(detected.choices.find((choice) => choice.mode === "update")?.available, true);
    assert.match(detected.choices.find((choice) => choice.mode === "clone")?.detail ?? "", /already exists|Clone HappyTG into/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("inspectRepo reports dirty worktrees and defaultDirtyWorktreeStrategy stays safe", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-repo-dirty-"));
  try {
    await git(["init"], tempDir);
    await git(["config", "user.email", "bot@example.com"], tempDir);
    await git(["config", "user.name", "HappyTG Bot"], tempDir);
    await writeFile(path.join(tempDir, "README.md"), "clean\n", "utf8");
    await git(["add", "."], tempDir);
    await git(["commit", "-m", "init"], tempDir);
    await writeFile(path.join(tempDir, "README.md"), "dirty\n", "utf8");

    const inspection = await inspectRepo({ repoPath: tempDir });
    assert.equal(inspection.isRepo, true);
    assert.equal(inspection.dirty, true);
    assert.equal(defaultDirtyWorktreeStrategy(true), "cancel");
    assert.equal(defaultDirtyWorktreeStrategy(false), "keep");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mergeEnvTemplate preserves existing values and writeMergedEnvFile is idempotent on rerun", async () => {
  const merged = mergeEnvTemplate({
    templateText: "TELEGRAM_BOT_TOKEN=\nLOG_LEVEL=info\n",
    existingText: "LOG_LEVEL=debug\nCUSTOM=value\n",
    updates: {
      TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx"
    }
  });

  assert.match(merged.content, /TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx/);
  assert.match(merged.content, /LOG_LEVEL=debug/);
  assert.match(merged.content, /CUSTOM=value/);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-env-"));
  try {
    await writeFile(path.join(tempDir, ".env.example"), "TELEGRAM_BOT_TOKEN=\nTELEGRAM_BOT_USERNAME=\nLOG_LEVEL=info\n", "utf8");
    await writeFile(path.join(tempDir, ".env"), "LOG_LEVEL=debug\n", "utf8");

    const first = await writeMergedEnvFile({
      repoRoot: tempDir,
      env: {
        HOME: tempDir
      },
      updates: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        TELEGRAM_BOT_USERNAME: "happytg_bot"
      }
    });
    const second = await writeMergedEnvFile({
      repoRoot: tempDir,
      env: {
        HOME: tempDir
      },
      updates: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        TELEGRAM_BOT_USERNAME: "happytg_bot"
      }
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.ok(first.backupPath);
    assert.equal(second.backupPath, undefined);
    assert.match(await readFile(path.join(tempDir, ".env"), "utf8"), /TELEGRAM_BOT_USERNAME=happytg_bot/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("retro installer renderers include active cursor and keyboard hints", () => {
  const welcome = renderWelcomeScreen({
    osLabel: "macOS arm64",
    shell: "/bin/zsh",
    packageManager: "Homebrew",
    statuses: [
      {
        status: "pass",
        label: "Git",
        detail: "Ready."
      }
    ]
  });
  const repoMode = renderRepoModeScreen({
    activeMode: "current",
    choices: [
      {
        mode: "clone",
        label: "Clone fresh checkout",
        path: "/tmp/HappyTG",
        available: true,
        detail: "Clone HappyTG into /tmp/HappyTG."
      },
      {
        mode: "current",
        label: "Use current directory",
        path: "/tmp/current",
        available: true,
        detail: "Current checkout."
      }
    ]
  });

  assert.match(welcome, /↑↓ navigate/);
  assert.match(welcome, /ENTER continue/);
  assert.match(repoMode, /Repo Mode/);
  assert.match(repoMode, /›/);
  assert.match(repoMode, /ESC cancel/);
});

test("Telegram screen renders a masked preview instead of the raw bot token", () => {
  const screen = renderTelegramScreen({
    form: {
      botToken: "123456789:ABCDEFghijklmnopQRST",
      allowedUserIds: [],
      homeChannel: ""
    },
    activeRow: 0,
    editing: false
  });

  assert.match(screen, /1234\*+QRST/);
  assert.doesNotMatch(screen, /123456789:ABCDEFghijklmnopQRST/);
});

test("waitForEnter resolves when ENTER close is pressed on the final screen", async () => {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream & { setRawMode: (value: boolean) => void; isTTY: boolean };
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream & { isTTY: boolean };
  let rawMode = false;
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = ((value: boolean) => {
    rawMode = value;
    return stdin;
  }) as typeof stdin.setRawMode;

  const wait = waitForEnter(stdin, stdout, "ENTER close\n");
  queueMicrotask(() => {
    stdin.emit("keypress", "\r", { name: "return" });
  });

  await wait;
  assert.equal(rawMode, false);
});

test("fetchTelegramBotIdentity separates invalid-token API rejections from recoverable network lookups", async () => {
  const invalid = await fetchTelegramBotIdentity(
    "123456:abcdefghijklmnopqrstuvwx",
    async () => new Response("", { status: 401 })
  );
  const network = await fetchTelegramBotIdentity(
    "123456:abcdefghijklmnopqrstuvwx",
    async () => {
      throw new TypeError("fetch failed");
    }
  );

  assert.equal(invalid.ok, false);
  assert.equal(invalid.failureKind, "invalid_token");
  assert.equal(invalid.recoverable, false);
  assert.equal(invalid.step, "getMe");

  assert.equal(network.ok, false);
  assert.equal(network.failureKind, "network_error");
  assert.equal(network.recoverable, true);
  assert.equal(network.step, "getMe");
});
