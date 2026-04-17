import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderText } from "./cli.js";
import { CommandExecutionError, runCommand } from "./install/commands.js";
import { createInstallRuntimeError } from "./install/errors.js";
import { runHappyTGInstall } from "./install/index.js";
import { syncRepository } from "./install/repo.js";
import { writeInstallDraft as persistInstallDraft } from "./install/state.js";
import { createTelegramFormController, reduceTelegramFormKeypress, renderMaskedSecretPreview } from "./install/tui.js";
import { runBootstrapCommand } from "./index.js";
import type { InstallDraftState, InstallerEnvironment, InstallerRepoSource, RepoInspection } from "./install/types.js";

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  await chmod(filePath, 0o755);
}

function batchQuote(value: string): string {
  return value.replace(/"/g, "\"\"");
}

async function createCrossPlatformWindowsShim(tempDir: string, name: string, version: string): Promise<{
  barePath: string;
  shimPath: string;
}> {
  const scriptName = `${name}-shim.mjs`;
  const scriptPath = path.join(tempDir, scriptName);
  await writeExecutable(
    scriptPath,
    `
      #!/usr/bin/env node
      const args = process.argv.slice(2);
      if (args[0] === "--version") {
        console.log(${JSON.stringify(version)});
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, `${name}.cmd`);
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${process.execPath}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\n"${batchQuote(process.execPath)}" "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
  } else {
    await writeExecutable(
      shimPath,
      `
        #!/bin/sh
        SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
        exec "${process.execPath}" "$SCRIPT_DIR/${scriptName}" "$@"
      `
    );
  }

  return {
    barePath: path.join(tempDir, name),
    shimPath
  };
}

async function reserveFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve a free port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function baseEnvironment(): InstallerEnvironment {
  return {
    platform: {
      platform: "linux",
      arch: "x64",
      shell: "/bin/sh",
      linuxFamily: "debian",
      systemPackageManager: "apt-get",
      repoPackageManager: "pnpm",
      isInteractiveTerminal: false
    },
    dependencies: []
  };
}

function windowsEnvironment(): InstallerEnvironment {
  const base = baseEnvironment();
  return {
    ...base,
    platform: {
      ...base.platform,
      platform: "win32",
      shell: "C:\\Windows\\System32\\cmd.exe",
      systemPackageManager: "winget"
    }
  };
}

function repoInspection(repoPath: string, overrides?: Partial<RepoInspection>): RepoInspection {
  return {
    path: repoPath,
    exists: false,
    isRepo: false,
    emptyDirectory: false,
    dirty: false,
    ...overrides
  };
}

const primarySource: InstallerRepoSource = {
  id: "primary",
  label: "primary source",
  url: "https://github.com/GermanMik/HappyTG.git"
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fallbackSource: InstallerRepoSource = {
  id: "fallback",
  label: "fallback source",
  url: "https://gitclone.com/github.com/GermanMik/HappyTG.git"
};

test("syncRepository retries transient primary failures and reports attempt progress", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-sync-retry-"));
  const clonePath = path.join(tempDir, "HappyTG");
  let cloneCalls = 0;
  const progress: string[] = [];

  try {
    const result = await syncRepository({
      selection: {
        mode: "clone",
        path: clonePath,
        dirtyStrategy: "keep"
      },
      sources: [primarySource],
      branch: "main",
      currentInspection: repoInspection(tempDir),
      updateInspection: repoInspection(clonePath),
      maxAttempts: 5,
      retryDelayMs: 0,
      onProgress: (event) => {
        progress.push(`${event.phase}:${event.attempt}/${event.maxAttempts}`);
      },
      runCommandImpl: async ({ args }) => {
        if (args?.[0] === "clone") {
          cloneCalls += 1;
          if (cloneCalls < 3) {
            return {
              stdout: "",
              stderr: "fatal: unable to access 'https://github.com/GermanMik/HappyTG.git/': Failed to connect to github.com port 443 after 1000 ms: Could not connect to server",
              exitCode: 1,
              binaryPath: "git",
              shell: false,
              fallbackUsed: false
            };
          }
        }

        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: "git",
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(cloneCalls, 3);
    assert.equal(result.repoSource, "primary");
    assert.equal(result.attempts, 3);
    assert.ok(progress.includes("attempt:1/5"));
    assert.ok(progress.includes("retry:1/5"));
    assert.ok(progress.includes("attempt:3/5"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncRepository returns repo_retry_exhausted after 5 primary attempts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-sync-exhaust-"));
  const clonePath = path.join(tempDir, "HappyTG");

  try {
    await assert.rejects(
      () => syncRepository({
        selection: {
          mode: "clone",
          path: clonePath,
          dirtyStrategy: "keep"
        },
        sources: [primarySource],
        branch: "main",
        currentInspection: repoInspection(tempDir),
        updateInspection: repoInspection(clonePath),
        maxAttempts: 5,
        retryDelayMs: 0,
        runCommandImpl: async () => ({
          stdout: "",
          stderr: "fatal: unable to access 'https://github.com/GermanMik/HappyTG.git/': Failed to connect to github.com port 443 after 1000 ms: Could not connect to server",
          exitCode: 1,
          binaryPath: "git",
          shell: false,
          fallbackUsed: false
        })
      }),
      (error: Error & { detail?: { code?: string; attempts?: number } }) => {
        assert.equal(error.detail?.code, "repo_retry_exhausted");
        assert.equal(error.detail?.attempts, 5);
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncRepository falls back to the configured alternative source after exhausting primary retries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-sync-fallback-"));
  const clonePath = path.join(tempDir, "HappyTG");
  const urls: string[] = [];

  try {
    const result = await syncRepository({
      selection: {
        mode: "clone",
        path: clonePath,
        dirtyStrategy: "keep"
      },
      sources: [primarySource, fallbackSource],
      branch: "main",
      currentInspection: repoInspection(tempDir),
      updateInspection: repoInspection(clonePath),
      maxAttempts: 5,
      retryDelayMs: 0,
      runCommandImpl: async ({ args }) => {
        const repoUrl = args?.[3] ?? "";
        urls.push(repoUrl);
        return {
          stdout: "",
          stderr: repoUrl === primarySource.url
            ? "fatal: unable to access 'https://github.com/GermanMik/HappyTG.git/': Failed to connect to github.com port 443 after 1000 ms: Could not connect to server"
            : "",
          exitCode: repoUrl === primarySource.url ? 1 : 0,
          binaryPath: "git",
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(result.repoSource, "fallback");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.repoUrl, fallbackSource.url);
    assert.equal(result.attempts, 6);
    assert.deepEqual(urls.slice(0, 5), Array.from({ length: 5 }, () => primarySource.url));
    assert.equal(urls[5], fallbackSource.url);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncRepository reports repo_fallback_failure when both configured sources fail", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-sync-fallback-fail-"));
  const clonePath = path.join(tempDir, "HappyTG");

  try {
    await assert.rejects(
      () => syncRepository({
        selection: {
          mode: "clone",
          path: clonePath,
          dirtyStrategy: "keep"
        },
        sources: [primarySource, fallbackSource],
        branch: "main",
        currentInspection: repoInspection(tempDir),
        updateInspection: repoInspection(clonePath),
        maxAttempts: 5,
        retryDelayMs: 0,
        runCommandImpl: async () => ({
          stdout: "",
          stderr: "fatal: unable to access remote: Could not connect to server",
          exitCode: 1,
          binaryPath: "git",
          shell: false,
          fallbackUsed: false
        })
      }),
      (error: Error & { detail?: { code?: string; attempts?: number; repoSource?: string; fallbackUsed?: boolean } }) => {
        assert.equal(error.detail?.code, "repo_fallback_failure");
        assert.equal(error.detail?.attempts, 10);
        assert.equal(error.detail?.repoSource, "fallback");
        assert.equal(error.detail?.fallbackUsed, true);
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runCommand normalizes Windows shim companions like pnpm.cmd", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-win-shim-"));
  try {
    const { barePath, shimPath } = await createCrossPlatformWindowsShim(tempDir, "pnpm", "pnpm test 9.0.0");
    const result = await runCommand({
      command: barePath,
      args: ["--version"],
      env: {
        PATH: process.env.PATH,
        Path: tempDir,
        PATHEXT: ".CMD;.EXE"
      } as NodeJS.ProcessEnv,
      platform: "win32"
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /pnpm test 9\.0\.0/);
    assert.equal(result.binaryPath, shimPath);
    assert.equal(result.fallbackUsed, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall returns a structured runtime error for Windows shim spawn failures instead of throwing usage-style failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-runtime-fail-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      telegramHomeChannel: "@home",
      backgroundMode: "manual",
      postChecks: []
    }, {
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => {
          throw new CommandExecutionError({
            code: "ENOENT",
            failedCommand: "pnpm",
            failedBinary: "pnpm",
            binaryPath: path.join(tempDir, "pnpm"),
            likelyWindowsShim: true,
            message: `pnpm failed to start from ${path.join(tempDir, "pnpm")}. This looks like a broken Windows shim or PATH issue.`
          });
        }
      }
    });

    assert.equal(result.status, "fail");
    assert.equal(result.error?.code, "windows_shim_failure");
    assert.equal(result.error?.failedBinary, "pnpm");
    assert.match(result.error?.binaryPath ?? "", /pnpm$/);
    assert.doesNotMatch(renderText(result), /Usage:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall returns a structured runtime error when non-interactive mode is missing a Telegram token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-missing-token-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramAllowedUserIds: [],
      postChecks: []
    }, {
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        readInstallDraft: async () => undefined
      }
    });

    assert.equal(result.status, "fail");
    assert.equal(result.outcome, "recoverable-failure");
    assert.equal(result.error?.code, "installer_validation_failure");
    assert.equal(result.error?.message, "Telegram bot token is required.");
    assert.doesNotMatch(JSON.stringify(result), /Usage:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall rejects bot usernames like @name in the token field before runtime work starts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-username-token-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "@Gerta_homebot",
      telegramAllowedUserIds: [],
      postChecks: []
    }, {
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        readInstallDraft: async () => undefined
      }
    });

    assert.equal(result.status, "fail");
    assert.equal(result.outcome, "recoverable-failure");
    assert.equal(result.error?.code, "installer_validation_failure");
    assert.match(result.error?.message ?? "", /BotFather token/);
    assert.doesNotMatch(renderText(result), /Usage:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall resumes saved installer values on rerun", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-resume-"));
  const repoPath = path.join(tempDir, "HappyTG");
  let savedDraft: InstallDraftState | undefined;
  let repoChoicePass = 0;

  const baseDeps = {
    detectInstallerEnvironment: async () => baseEnvironment(),
    readInstallDraft: async () => savedDraft,
    writeInstallDraft: async ({ draft }: Parameters<typeof persistInstallDraft>[0]) => {
      savedDraft = {
        ...draft,
        updatedAt: draft.updatedAt ?? "2026-04-11T00:00:00.000Z"
      };
      return savedDraft;
    },
    detectRepoModeChoices: async () => {
      repoChoicePass += 1;
      if (repoChoicePass === 1) {
        return {
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath, {
            exists: true,
            emptyDirectory: true
          }),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        };
      }

      return {
        clonePath: repoPath,
        currentInspection: repoInspection(tempDir),
        updateInspection: repoInspection(repoPath, {
          exists: true,
          isRepo: true,
          emptyDirectory: false,
          rootPath: repoPath
        }),
        choices: [
          {
            mode: "clone" as const,
            label: "Clone fresh checkout",
            path: repoPath,
            available: false,
            detail: "Target already has a checkout."
          },
          {
            mode: "update" as const,
            label: "Update existing checkout",
            path: repoPath,
            available: true,
            detail: "Existing checkout is ready to update."
          }
        ]
      };
    }
  };

  try {
    await mkdir(repoPath, { recursive: true });

    const first = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001", "1002"],
      telegramHomeChannel: "@home",
      backgroundMode: "manual",
      postChecks: ["doctor"]
    }, {
      deps: {
        ...baseDeps,
        syncRepository: async () => {
          throw createInstallRuntimeError({
            code: "repo_retry_exhausted",
            message: "primary source remained unreachable after 5 attempts.",
            lastError: "fatal: unable to access remote",
            retryable: true,
            suggestedAction: "Retry later.",
            attempts: 5,
            repoUrl: primarySource.url,
            repoSource: "primary"
          });
        }
      }
    });
    assert.equal(first.status, "fail");
    assert.equal(savedDraft?.telegram?.botToken, "123456:abcdefghijklmnopqrstuvwx");

    let envUpdates: Record<string, string | undefined> | undefined;
    const second = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramAllowedUserIds: [],
      postChecks: ["setup", "doctor", "verify"]
    }, {
      deps: {
        ...baseDeps,
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async ({ updates }) => {
          envUpdates = updates;
          return {
            envFilePath: path.join(repoPath, ".env"),
            created: true,
            changed: true,
            addedKeys: Object.keys(updates),
            preservedKeys: []
          };
        },
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: mode === "manual" ? "manual" : "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(second.status, "warn", JSON.stringify(second, null, 2));
    assert.equal(second.repo.mode, "update");
    assert.deepEqual(second.telegram.allowedUserIds, ["1001", "1002"]);
    assert.equal(second.telegram.homeChannel, "@home");
    assert.equal(second.background.mode, "manual");
    assert.equal(envUpdates?.TELEGRAM_BOT_TOKEN, "123456:abcdefghijklmnopqrstuvwx");
    assert.equal(envUpdates?.TELEGRAM_HOME_CHANNEL, "@home");
    assert.deepEqual(second.steps.filter((step) => step.id.startsWith("check-")).map((step) => step.id), ["check-doctor"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Telegram setup reducer treats pasted token chunks as text and preserves editing/navigation behavior", () => {
  let state = createTelegramFormController({
    botToken: "",
    allowedUserIds: [],
    homeChannel: ""
  });

  const apply = (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
    const reduced = reduceTelegramFormKeypress(state, {
      chunk,
      key: key as Parameters<typeof reduceTelegramFormKeypress>[1]["key"]
    });
    state = reduced.state;
    return reduced.done;
  };

  apply("", { name: "return" });
  apply("\u001B[200~123456:abcdefghijklmnopqrstuvwx\u001B[201~");
  assert.equal(
    renderMaskedSecretPreview(state.draft),
    `1234${"*".repeat("123456:abcdefghijklmnopqrstuvwx".length - 8)}uvwx`
  );
  apply("", { name: "return" });
  assert.equal(state.form.botToken, "123456:abcdefghijklmnopqrstuvwx");

  apply("", { name: "down" });
  apply("", { name: "return" });
  apply("1001, 1002, 1003");
  apply("", { name: "backspace" });
  apply("", { name: "return" });
  assert.deepEqual(state.form.allowedUserIds, ["1001", "1002", "100"]);

  apply("", { name: "down" });
  apply("", { name: "return" });
  apply("@home");
  apply("", { name: "return" });
  assert.equal(state.form.homeChannel, "@home");

  assert.equal(apply("", { name: "down" }), false);
  assert.equal(apply("", { name: "return" }), true);
});

test("Telegram setup reducer commits pasted token and allowed user ID chunks that include trailing CRLF", () => {
  let state = createTelegramFormController({
    botToken: "",
    allowedUserIds: [],
    homeChannel: ""
  });

  const apply = (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
    const reduced = reduceTelegramFormKeypress(state, {
      chunk,
      key: key as Parameters<typeof reduceTelegramFormKeypress>[1]["key"]
    });
    state = reduced.state;
    return reduced.done;
  };

  apply("", { name: "return" });
  apply("\u001B[200~123456:abcdefghijklmnopqrstuvwx\r\n\u001B[201~");
  assert.equal(state.editing, false);
  assert.equal(state.form.botToken, "123456:abcdefghijklmnopqrstuvwx");
  assert.equal(state.validationMessage, undefined);

  apply("", { name: "down" });
  apply("", { name: "return" });
  apply("1001\r\n1002\r\n");
  assert.equal(state.editing, false);
  assert.deepEqual(state.form.allowedUserIds, ["1001", "1002"]);
});

test("Telegram setup reducer supports clearing a prefilled token and pasting a replacement", () => {
  const originalToken = "654321:oldtokenvalueabcdefghijkl";
  const replacementToken = "123456:replacementtokenqrstuvwx";
  let state = createTelegramFormController({
    botToken: originalToken,
    allowedUserIds: [],
    homeChannel: ""
  });

  const apply = (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
    const reduced = reduceTelegramFormKeypress(state, {
      chunk,
      key: key as Parameters<typeof reduceTelegramFormKeypress>[1]["key"]
    });
    state = reduced.state;
    return reduced.done;
  };

  apply("", { name: "return" });
  for (let index = 0; index < originalToken.length; index += 1) {
    apply("", { name: "backspace" });
  }
  assert.equal(state.draft, "");

  apply(`\u001B[200~${replacementToken}\r\n\u001B[201~`);
  assert.equal(state.editing, false);
  assert.equal(state.form.botToken, replacementToken);
});

test("renderMaskedSecretPreview safely degrades for short values", () => {
  const longToken = "123456789:ABCDEFghijklmnopQRST";
  assert.equal(renderMaskedSecretPreview(longToken), `1234${"*".repeat(longToken.length - 8)}QRST`);
  assert.equal(renderMaskedSecretPreview("1234567"), "*******");
  assert.equal(renderMaskedSecretPreview(""), "");
});

test("Telegram setup reducer blocks invalid @bot usernames and keeps the user in the form", () => {
  let state = createTelegramFormController({
    botToken: "",
    allowedUserIds: [],
    homeChannel: ""
  });

  const apply = (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
    const reduced = reduceTelegramFormKeypress(state, {
      chunk,
      key: key as Parameters<typeof reduceTelegramFormKeypress>[1]["key"]
    });
    state = reduced.state;
    return reduced.done;
  };

  apply("", { name: "return" });
  apply("@Gerta_homebot");
  apply("", { name: "return" });
  assert.equal(state.form.botToken, "@Gerta_homebot");
  assert.match(state.validationMessage ?? "", /BotFather token/);

  const done = apply("", { name: "down" }) || apply("", { name: "down" }) || apply("", { name: "down" }) || apply("", { name: "return" });
  assert.equal(done, false);
  assert.equal(state.activeRow, 0);
  assert.match(state.validationMessage ?? "", /BotFather token/);
});

test("runHappyTGInstall reports warning-only Telegram getMe failures as success-with-warnings without dropping configured Telegram state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-warning-only-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: []
    }, {
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: true,
          changed: true,
          addedKeys: ["TELEGRAM_BOT_TOKEN"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: false,
          error: "fetch failed"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.status, "warn");
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.warnings, ["Telegram getMe warning: Telegram API getMe could not confirm the bot identity: fetch failed."]);
    assert.equal(result.telegram.configured, true);
    assert.equal(result.telegram.lookup?.status, "warning");
    assert.equal(result.telegram.lookup?.failureKind, "unexpected_response");
    assert.match(result.telegram.lookup?.message ?? "", /getMe could not confirm the bot identity/i);
    assert.doesNotMatch(renderText(result), /\[FAIL\]/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive Telegram form starts blank even when draft and .env already contain a token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-interactive-token-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const envToken = "999999:envtokenvalueabcdefghijk";
  const draftToken = "888888:drafttokenvalueqrstuvw";
  const newToken = "123456:abcdefghijklmnopqrstuvwx";
  const transcript: string[] = [];
  let envUpdates: Record<string, string | undefined> | undefined;

  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream & { setRawMode: (value: boolean) => void; isTTY: boolean };
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream & { isTTY: boolean };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = ((_: boolean) => stdin) as typeof stdin.setRawMode;
  stdout.on("data", (chunk) => {
    transcript.push(String(chunk));
  });

  const emitKeypress = async (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
    await new Promise((resolve) => setImmediate(resolve));
    stdin.emit("keypress", chunk, key);
  };
  const waitForOutput = async (pattern: string | RegExp) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const rendered = transcript.join("");
      const matched = typeof pattern === "string"
        ? rendered.includes(pattern)
        : pattern.test(rendered);
      if (matched) {
        return rendered;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${pattern.toString()}`);
  };

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env"),
      `TELEGRAM_BOT_TOKEN=${envToken}\nTELEGRAM_HOME_CHANNEL=@existing\n`,
      "utf8"
    );

    const install = runHappyTGInstall({
      json: false,
      nonInteractive: false,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramAllowedUserIds: [],
      backgroundMode: "manual",
      postChecks: []
    }, {
      stdin,
      stdout,
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => ({
          version: 1,
          telegram: {
            botToken: draftToken,
            allowedUserIds: ["42"],
            homeChannel: "@draft"
          },
          updatedAt: "2026-04-14T00:00:00.000Z"
        }),
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath, {
            exists: true,
            isRepo: true,
            emptyDirectory: false,
            rootPath: repoPath
          }),
          choices: [
            {
              mode: "update" as const,
              label: "Update existing checkout",
              path: repoPath,
              available: true,
              detail: "Existing checkout is ready to update."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "updated",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async ({ updates }) => {
          envUpdates = updates;
          return {
            envFilePath: path.join(repoPath, ".env"),
            created: false,
            changed: true,
            addedKeys: Object.keys(updates),
            preservedKeys: []
          };
        },
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: mode === "manual" ? "manual" : "configured",
          detail: "Configured by test."
        })
      }
    });

    await waitForOutput("Welcome / Preflight");
    await emitKeypress("\r", { name: "return" });
    await waitForOutput("Repo Mode");
    await emitKeypress("\r", { name: "return" });
    const telegramScreen = await waitForOutput("Telegram Setup");
    assert.match(telegramScreen, /<required>/);
    assert.doesNotMatch(telegramScreen, new RegExp(renderMaskedSecretPreview(envToken).replace(/\*/g, "\\*")));
    assert.doesNotMatch(telegramScreen, new RegExp(renderMaskedSecretPreview(draftToken).replace(/\*/g, "\\*")));

    await emitKeypress("\r", { name: "return" });
    await emitKeypress(`\u001B[200~${newToken}\r\n\u001B[201~`);
    await emitKeypress("", { name: "down" });
    await emitKeypress("", { name: "down" });
    await emitKeypress("", { name: "down" });
    await emitKeypress("\r", { name: "return" });
    await waitForOutput("Background Run Mode");
    await emitKeypress("\r", { name: "return" });
    await waitForOutput("Post-Install Checks");
    await emitKeypress("\r", { name: "return" });
    await waitForOutput("Final Summary");
    await emitKeypress("\r", { name: "return" });

    const result = await install;
    assert.equal(result.status, "warn");
    assert.equal(result.telegram.configured, true);
    assert.equal(envUpdates?.TELEGRAM_BOT_TOKEN, newToken);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps an already-known Telegram username when getMe lookup fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-telegram-known-name-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });
  await writeFile(
    path.join(repoPath, ".env"),
    "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\nTELEGRAM_BOT_USERNAME=known_happytg_bot\n",
    "utf8"
  );

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: []
    }, {
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: ["TELEGRAM_BOT_USERNAME"]
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: false,
          error: "fetch failed"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.telegram.bot?.username, "known_happytg_bot");
    assert.match(result.telegram.lookup?.message ?? "", /Existing bot username @known_happytg_bot was kept\./);
    assert.ok(result.nextSteps.some((step) => step.includes("@known_happytg_bot")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall normalizes completed post-check failures into recoverable installer failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-partial-fail-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: ["verify"]
    }, {
      runBootstrapCheck: async () => ({
        id: "btr_verify",
        hostFingerprint: "fp",
        command: "verify",
        status: "fail",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "HOST_NOT_PAIRED",
            severity: "error",
            message: "Host is not paired yet."
          }
        ],
        planPreview: [],
        reportJson: {},
        createdAt: "2026-04-12T00:00:00.000Z"
      }),
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: true,
          changed: true,
          addedKeys: ["TELEGRAM_BOT_TOKEN"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.status, "fail");
    assert.equal(result.outcome, "recoverable-failure");
    assert.equal(result.error?.code, "installer_partial_failure");
    assert.match(result.error?.lastError ?? "", /Host is not paired yet/);
    assert.doesNotMatch(renderText(result), /Result: install flow is complete/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps the final result at warning level when post-checks only report Codex PATH follow-up", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-postcheck-warn-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const codexWarning = "Codex CLI worked through the npm wrapper, but the shell PATH still needs an update.";
    const codexNextStep = "Add the npm global bin directory to PATH, restart the shell, then verify `codex --version`.";
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: ["setup", "doctor", "verify"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "CODEX_PATH_PENDING",
            severity: "warn",
            message: codexWarning
          }
        ],
        planPreview: [codexNextStep],
        reportJson: {},
        createdAt: "2026-04-13T00:00:00.000Z"
      }),
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: true,
          changed: true,
          addedKeys: ["TELEGRAM_BOT_TOKEN"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.status, "warn");
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.equal(result.warnings.filter((warning) => warning === codexWarning).length, 1);
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 1);
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    assert.equal(result.steps.filter((step) => step.id.startsWith("check-")).every((step) => step.status === "warn"), true);
    const rendered = renderText(result);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexNextStep).length - 1, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps Telegram and deduped Codex PATH follow-up visible in the final summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-postcheck-mixed-warn-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const telegramWarning = "Telegram getMe warning: Telegram API getMe could not confirm the bot identity: fetch failed.";
    const codexWarning = "Codex CLI worked through the npm wrapper, but the shell PATH still needs an update.";
    const codexNextStep = "Add the npm global bin directory to PATH, restart the shell, then verify `codex --version`.";
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: ["setup", "doctor", "verify"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "CODEX_PATH_PENDING",
            severity: "warn",
            message: codexWarning
          }
        ],
        planPreview: [codexNextStep],
        reportJson: {},
        createdAt: "2026-04-13T00:00:00.000Z"
      }),
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: true,
          changed: true,
          addedKeys: ["TELEGRAM_BOT_TOKEN"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: false,
          error: "fetch failed"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.status, "warn");
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.warnings, [telegramWarning, codexWarning]);
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 1);
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    const rendered = renderText(result);
    assert.equal(rendered.split(telegramWarning).length - 1, 1);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexNextStep).length - 1, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall semantically dedupes repeated setup next steps and compresses repeated post-check warning sets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-semantic-dedupe-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const codexWarning = "Codex CLI completed the smoke check with warnings: Codex Responses websocket returned 403 Forbidden, then the CLI fell back to HTTP. Run `pnpm happytg doctor --json` for stderr details.";
    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: ["setup", "doctor", "verify"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "CODEX_SMOKE_WARNINGS",
            severity: "warn",
            message: codexWarning
          }
        ],
        planPreview: [
          "Start repo services: `pnpm dev`.",
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to Telegram, then start the daemon with `pnpm dev:daemon`."
        ],
        reportJson: {},
        createdAt: "2026-04-17T00:00:00.000Z"
      }),
      deps: {
        detectInstallerEnvironment: async () => baseEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: path.join(tempDir, "pnpm"),
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: true,
          changed: true,
          addedKeys: ["TELEGRAM_BOT_TOKEN"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "manual",
          detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(result.nextSteps.filter((step) => step === "pnpm dev").length, 1);
    assert.equal(result.nextSteps.filter((step) => step === "pnpm daemon:pair").length, 1);
    assert.equal(result.nextSteps.filter((step) => /Send `\/pair <CODE>`/u.test(step)).length, 1);
    assert.equal(result.nextSteps.some((step) => step === "Start repo services: `pnpm dev`."), false);
    assert.equal(result.nextSteps.some((step) => step === "Request a pairing code on the execution host: `pnpm daemon:pair`."), false);
    assert.match(result.steps.find((step) => step.id === "check-setup")?.detail ?? "", /Codex CLI completed the smoke check with warnings/i);
    assert.equal(result.steps.find((step) => step.id === "check-doctor")?.detail, "No new warnings beyond `setup`; the same warning set was confirmed.");
    assert.equal(result.steps.find((step) => step.id === "check-verify")?.detail, "No new warnings beyond `setup`; the same warning set was confirmed.");
    assert.match(result.postChecks[1]?.summary ?? "", /Same warning set as setup/i);
    assert.match(result.postChecks[2]?.summary ?? "", /Same warning set as setup/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps Windows APPDATA wrapper post-checks at warning level with real bootstrap checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-appdata-wrapper-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  const configPath = path.join(tempDir, "config.toml");
  const gitBinaryPath = path.join(tempDir, "git.cmd");
  const pnpmBinaryPath = path.join(tempDir, "pnpm.cmd");
  const stateDir = path.join(tempDir, ".happytg-state");
  const appDataDir = path.join(tempDir, "AppData", "Roaming");
  const npmBinDir = path.join(appDataDir, "npm");
  await mkdir(npmBinDir, { recursive: true });
  const { shimPath: wrapperPath } = await createCrossPlatformWindowsShim(npmBinDir, "codex", "codex shim 0.119.0");

  const previousEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    PATHEXT: process.env.PATHEXT,
    pathext: process.env.pathext,
    APPDATA: process.env.APPDATA,
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME,
    CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH,
    HAPPYTG_STATE_DIR: process.env.HAPPYTG_STATE_DIR,
    HAPPYTG_MINIAPP_PORT: process.env.HAPPYTG_MINIAPP_PORT,
    HAPPYTG_API_PORT: process.env.HAPPYTG_API_PORT,
    HAPPYTG_BOT_PORT: process.env.HAPPYTG_BOT_PORT,
    HAPPYTG_WORKER_PORT: process.env.HAPPYTG_WORKER_PORT,
    HAPPYTG_REDIS_HOST_PORT: process.env.HAPPYTG_REDIS_HOST_PORT,
    REDIS_URL: process.env.REDIS_URL
  };

  try {
    await Promise.all([
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8")
    ]);

    process.env.PATH = tempDir;
    process.env.Path = "";
    process.env.PATHEXT = "";
    process.env.pathext = ".cmd;.exe";
    process.env.APPDATA = appDataDir;
    process.env.USERPROFILE = tempDir;
    process.env.HOME = tempDir;
    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.HAPPYTG_STATE_DIR = stateDir;
    process.env.HAPPYTG_MINIAPP_PORT = String(await reserveFreePort());
    process.env.HAPPYTG_API_PORT = String(await reserveFreePort());
    process.env.HAPPYTG_BOT_PORT = String(await reserveFreePort());
    process.env.HAPPYTG_WORKER_PORT = String(await reserveFreePort());
    process.env.HAPPYTG_REDIS_HOST_PORT = String(await reserveFreePort());
    process.env.REDIS_URL = "redis://example.com:6379";

    const result = await runHappyTGInstall({
      json: true,
      nonInteractive: true,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: ["1001"],
      backgroundMode: "manual",
      postChecks: ["setup", "doctor", "verify"]
    }, {
      runBootstrapCheck: runBootstrapCommand,
      deps: {
        detectInstallerEnvironment: async () => windowsEnvironment(),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath),
          choices: [
            {
              mode: "clone" as const,
              label: "Clone fresh checkout",
              path: repoPath,
              available: true,
              detail: "Clone HappyTG into the target."
            }
          ]
        }),
        syncRepository: async () => ({
          path: repoPath,
          sync: "cloned",
          repoSource: "primary",
          repoUrl: primarySource.url,
          attempts: 1,
          fallbackUsed: false
        }),
        resolveExecutable: async (command) => command === "pnpm" ? pnpmBinaryPath : undefined,
        runCommand: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: pnpmBinaryPath,
          shell: false,
          fallbackUsed: false
        }),
        writeMergedEnvFile: async ({ repoRoot, updates }) => {
          const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
          const envFilePath = path.join(repoRoot, ".env");
          await writeFile(
            envFilePath,
            `${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
            "utf8"
          );
          return {
            envFilePath,
            created: true,
            changed: true,
            addedKeys: entries.map(([key]) => key),
            preservedKeys: []
          };
        },
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    const rendered = renderText(result);
    const escapedNpmBinDir = npmBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const codexWarning = `Codex CLI worked through the npm wrapper at \`${wrapperPath}\`, but \`${npmBinDir}\` is not on the current shell PATH yet. Update PATH or restart the shell so plain \`codex\` resolves directly.`;
    const codexNextStep = `Add \`${npmBinDir}\` to PATH, restart the shell, then verify \`codex --version\`.`;

    assert.equal(result.status, "warn");
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.equal(result.warnings.filter((warning) => warning === codexWarning).length, 1);
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 1);
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    assert.equal(result.steps.filter((step) => step.id.startsWith("check-")).every((step) => step.status === "warn"), true);
    assert.ok(result.postChecks.some((check) => new RegExp(escapedNpmBinDir).test(check.summary)));
    assert.match(rendered, /install flow is complete with warnings/i);
    assert.doesNotMatch(rendered, /install needs follow-up/i);
    assert.doesNotMatch(rendered, /recoverable issues/i);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexNextStep).length - 1, 1);
    assert.ok(wrapperPath.endsWith("codex.cmd"));
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
