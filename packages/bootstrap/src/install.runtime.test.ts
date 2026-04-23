import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { legacyPlanPreviewFromAutomation, type AutomationItem } from "./finalization.js";
import type { BootstrapReport } from "../../protocol/src/index.js";
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

function reportJsonWithOnboarding(items: AutomationItem[]): { onboarding: { items: AutomationItem[]; steps: string[] } } {
  return {
    onboarding: {
      items,
      steps: legacyPlanPreviewFromAutomation(items)
    }
  };
}

function setupReportWithPorts(input: {
  ports: Array<Record<string, unknown>>;
  findings?: BootstrapReport["findings"];
  onboardingItems?: AutomationItem[];
  status?: BootstrapReport["status"];
}): BootstrapReport {
  const onboardingItems = input.onboardingItems ?? [];
  return {
    id: "btr_setup",
    hostFingerprint: "fp",
    command: "setup",
    status: input.status ?? (input.findings && input.findings.length > 0 ? "warn" : "pass"),
    profileRecommendation: "recommended",
    findings: input.findings ?? [],
    planPreview: legacyPlanPreviewFromAutomation(onboardingItems),
    reportJson: {
      ports: input.ports,
      plannedPorts: input.ports,
      preflight: [],
      onboarding: {
        items: onboardingItems,
        steps: legacyPlanPreviewFromAutomation(onboardingItems),
        overrideExamples: []
      }
    },
    createdAt: "2026-04-18T00:00:00.000Z"
  };
}

function createInteractiveHarness(): {
  stdin: PassThrough & NodeJS.ReadStream & { setRawMode: (value: boolean) => void; isTTY: boolean };
  stdout: PassThrough & NodeJS.WriteStream & { isTTY: boolean };
  emitKeypress: (chunk: string, key?: { name?: string; ctrl?: boolean; meta?: boolean }) => Promise<void>;
  waitForOutput: (pattern: string | RegExp) => Promise<string>;
  transcriptText: () => string;
} {
  const transcript: string[] = [];
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream & { setRawMode: (value: boolean) => void; isTTY: boolean };
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream & { isTTY: boolean };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = ((_: boolean) => stdin) as typeof stdin.setRawMode;
  stdout.on("data", (chunk) => {
    transcript.push(String(chunk));
  });

  return {
    stdin,
    stdout,
    emitKeypress: async (chunk, key = {}) => {
      await new Promise((resolve) => setImmediate(resolve));
      stdin.emit("keypress", chunk, key);
    },
    waitForOutput: async (pattern) => {
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
    },
    transcriptText: () => transcript.join("")
  };
}

async function advanceInteractiveInstallToPortPreflight(input: {
  waitForOutput: (pattern: string | RegExp) => Promise<string>;
  emitKeypress: (chunk: string, key?: { name?: string; ctrl?: boolean; meta?: boolean }) => Promise<void>;
}): Promise<void> {
  await input.waitForOutput("Welcome / Preflight");
  await input.emitKeypress("\r", { name: "enter" });
  await input.waitForOutput("Repo Mode");
  await input.emitKeypress("\r", { name: "enter" });
  await input.waitForOutput("Telegram Setup");
  await input.emitKeypress("", { name: "down" });
  await input.emitKeypress("", { name: "down" });
  await input.emitKeypress("", { name: "down" });
  await input.emitKeypress("\r", { name: "enter" });
  await input.waitForOutput("Background Run Mode");
  await input.emitKeypress("\r", { name: "enter" });
  await input.waitForOutput("Launch Mode");
  await input.emitKeypress("\r", { name: "enter" });
  await input.waitForOutput("Post-Install Checks");
  await input.emitKeypress("\r", { name: "enter" });
}

async function runInstallWithPnpmBehavior(input: {
  tempDir: string;
  repoPath: string;
  installStdout?: string;
  installStderr?: string;
  helpOutput?: string;
  helpExitCode?: number;
  pnpmVersion?: string;
  toolchainStdout?: string;
  toolchainStderr?: string;
  toolchainExitCode?: number;
}): Promise<{
  commandCalls: string[][];
  result: Awaited<ReturnType<typeof runHappyTGInstall>>;
}> {
  const commandCalls: string[][] = [];
  const pnpmBinaryPath = path.join(input.tempDir, "pnpm");

  const result = await runHappyTGInstall({
    json: true,
    nonInteractive: true,
    cwd: input.tempDir,
    launchCwd: input.tempDir,
    bootstrapRepoRoot: REPO_ROOT,
    repoDir: input.repoPath,
    repoUrl: primarySource.url,
    branch: "main",
    telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
    telegramAllowedUserIds: ["1001"],
    backgroundMode: "skip",
    postChecks: []
  }, {
    deps: {
      detectInstallerEnvironment: async () => baseEnvironment(),
      readInstallDraft: async () => undefined,
      detectRepoModeChoices: async () => ({
        clonePath: input.repoPath,
        currentInspection: repoInspection(input.tempDir),
        updateInspection: repoInspection(input.repoPath),
        choices: [
          {
            mode: "clone" as const,
            label: "Clone fresh checkout",
            path: input.repoPath,
            available: true,
            detail: "Clone HappyTG into the target."
          }
        ]
      }),
      syncRepository: async () => ({
        path: input.repoPath,
        sync: "cloned",
        repoSource: "primary",
        repoUrl: primarySource.url,
        attempts: 1,
        fallbackUsed: false
      }),
      resolveExecutable: async (command) => command === "pnpm" ? pnpmBinaryPath : undefined,
      runCommand: async ({ args }) => {
        const normalizedArgs = [...(args ?? [])];
        commandCalls.push(normalizedArgs);

        if (normalizedArgs[0] === "install") {
          return {
            stdout: input.installStdout ?? "",
            stderr: input.installStderr ?? "",
            exitCode: 0,
            binaryPath: pnpmBinaryPath,
            shell: false,
            fallbackUsed: false
          };
        }

        if (normalizedArgs[0] === "--version") {
          return {
            stdout: `${input.pnpmVersion ?? "10.0.0"}\n`,
            stderr: "",
            exitCode: 0,
            binaryPath: pnpmBinaryPath,
            shell: false,
            fallbackUsed: false
          };
        }

        if (normalizedArgs[0] === "help" && normalizedArgs[1] === "approve-builds") {
          return {
            stdout: input.helpOutput ?? "Version 10.0.0\nNo results for \"approve-builds\"\n",
            stderr: "",
            exitCode: input.helpExitCode ?? 0,
            binaryPath: pnpmBinaryPath,
            shell: false,
            fallbackUsed: false
          };
        }

        if (normalizedArgs[0] === "exec" && normalizedArgs[1] === "tsx" && normalizedArgs[2] === "--eval") {
          return {
            stdout: input.toolchainStdout ?? "HTG_PNPM_TOOLCHAIN_OK:1\n",
            stderr: input.toolchainStderr ?? "",
            exitCode: input.toolchainExitCode ?? 0,
            binaryPath: pnpmBinaryPath,
            shell: false,
            fallbackUsed: false
          };
        }

        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: pnpmBinaryPath,
          shell: false,
          fallbackUsed: false
        };
      },
      writeMergedEnvFile: async () => ({
        envFilePath: path.join(input.repoPath, ".env"),
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
        status: "skipped",
        detail: "Background daemon setup was skipped."
      })
    }
  });

  return {
    commandCalls,
    result
  };
}

test("runHappyTGInstall defaults to local launch and does not start Docker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-local-launch-"));
  const repoPath = path.join(tempDir, "HappyTG");
  let dockerLaunchCalls = 0;

  try {
    await mkdir(repoPath, { recursive: true });
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
        }),
        runDockerLaunch: async () => {
          dockerLaunchCalls += 1;
          throw new Error("Docker launch should not run for the default local mode.");
        }
      }
    });

    assert.equal(dockerLaunchCalls, 0);
    assert.equal(result.launch.mode, "local");
    assert.equal(result.finalization?.items.find((item) => item.id === "start-repo-services")?.message, "Start local repo services: `pnpm dev`.");
    assert.equal(result.finalization?.items.find((item) => item.id === "start-daemon")?.message, "Start the daemon with `pnpm dev:daemon`.");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall launch-mode docker validates config, starts Compose, and probes published services", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-docker-launch-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const pnpmPath = path.join(tempDir, "pnpm");
  const dockerPath = path.join(tempDir, "docker");
  const dockerCalls: Array<{ args: string[]; cwd?: string }> = [];
  const readyUrls: string[] = [];

  try {
    await mkdir(repoPath, { recursive: true });
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
      backgroundMode: "skip",
      launchMode: "docker",
      postChecks: []
    }, {
      fetchImpl: async (url) => {
        readyUrls.push(String(url));
        return new Response("ok", { status: 200 });
      },
      runBootstrapCheck: async () => setupReportWithPorts({
        status: "pass",
        ports: []
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
        resolveExecutable: async (command) => command === "pnpm" ? pnpmPath : command === "docker" ? dockerPath : undefined,
        runCommand: async ({ command, args, cwd }) => {
          const normalizedArgs = [...(args ?? [])];
          if (command === dockerPath) {
            dockerCalls.push({ args: normalizedArgs, cwd });
            if (normalizedArgs[0] === "compose" && normalizedArgs[1] === "version") {
              return { stdout: "Docker Compose version v2.29.0\n", stderr: "", exitCode: 0, binaryPath: dockerPath, shell: false, fallbackUsed: false };
            }
            if (normalizedArgs[0] === "info") {
              return { stdout: "Server Version: 27.0.0\n", stderr: "", exitCode: 0, binaryPath: dockerPath, shell: false, fallbackUsed: false };
            }
            if (normalizedArgs.at(-1) === "config") {
              return { stdout: "services:\n  api: {}\n", stderr: "", exitCode: 0, binaryPath: dockerPath, shell: false, fallbackUsed: false };
            }
            if (normalizedArgs.includes("up")) {
              return { stdout: "Container happytg-api Started\n", stderr: "", exitCode: 0, binaryPath: dockerPath, shell: false, fallbackUsed: false };
            }
            if (normalizedArgs.includes("ps")) {
              return {
                stdout: JSON.stringify([
                  { Service: "api", State: "running", Health: "healthy" },
                  { Service: "bot", State: "running", Health: "healthy" },
                  { Service: "miniapp", State: "running", Health: "healthy" },
                  { Service: "worker", State: "running", Health: "healthy" }
                ]),
                stderr: "",
                exitCode: 0,
                binaryPath: dockerPath,
                shell: false,
                fallbackUsed: false
              };
            }
          }

          return { stdout: "", stderr: "", exitCode: 0, binaryPath: pnpmPath, shell: false, fallbackUsed: false };
        },
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
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    assert.equal(result.launch.mode, "docker");
    assert.equal(result.launch.status, "started");
    assert.deepEqual(dockerCalls.map((call) => call.args), [
      ["compose", "version"],
      ["info"],
      ["compose", "--env-file", ".env", "-f", "infra/docker-compose.example.yml", "config"],
      ["compose", "--env-file", ".env", "-f", "infra/docker-compose.example.yml", "up", "--build", "-d"],
      ["compose", "--env-file", ".env", "-f", "infra/docker-compose.example.yml", "ps", "--format", "json"]
    ]);
    assert.equal(dockerCalls.every((call) => call.cwd === repoPath), true);
    assert.deepEqual(readyUrls, [
      "http://127.0.0.1:4000/ready",
      "http://127.0.0.1:4100/ready",
      "http://127.0.0.1:3001/ready"
    ]);
    assert.equal(result.finalization?.items.find((item) => item.id === "start-repo-services")?.kind, "auto");
    assert.match(JSON.stringify(result.reportJson.launch), /docker compose --env-file \.env -f infra\/docker-compose\.example\.yml up --build -d/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall launch-mode docker reports missing Docker as recoverable and keeps host daemon guidance outside Compose", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-docker-missing-"));
  const repoPath = path.join(tempDir, "HappyTG");

  try {
    await mkdir(repoPath, { recursive: true });
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
      launchMode: "docker",
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
        runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0, binaryPath: path.join(tempDir, "pnpm"), shell: false, fallbackUsed: false }),
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

    assert.equal(result.status, "fail");
    assert.equal(result.outcome, "recoverable-failure");
    assert.equal(result.launch.status, "failed");
    assert.match(result.launch.detail, /Docker binary was not found/);
    assert.equal(result.finalization?.items.find((item) => item.id === "host-daemon-outside-compose")?.kind, "manual");
    assert.match(result.finalization?.items.find((item) => item.id === "host-daemon-outside-compose")?.message ?? "", /host daemon is not part of Docker Compose/i);
    assert.equal(result.finalization?.items.find((item) => item.id === "start-daemon")?.kind, "manual");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall launch-mode docker reports daemon unavailable separately from a missing binary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-docker-daemon-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const dockerPath = path.join(tempDir, "docker");

  try {
    await mkdir(repoPath, { recursive: true });
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
      backgroundMode: "skip",
      launchMode: "docker",
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
        syncRepository: async () => ({ path: repoPath, sync: "cloned", repoSource: "primary", repoUrl: primarySource.url, attempts: 1, fallbackUsed: false }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : command === "docker" ? dockerPath : undefined,
        runCommand: async ({ command, args }) => {
          if (command === dockerPath && args?.[0] === "compose") {
            return { stdout: "Docker Compose version v2.29.0\n", stderr: "", exitCode: 0, binaryPath: dockerPath, shell: false, fallbackUsed: false };
          }
          if (command === dockerPath && args?.[0] === "info") {
            return { stdout: "", stderr: "Cannot connect to the Docker daemon at npipe:////./pipe/dockerDesktopLinuxEngine. Is the docker daemon running?", exitCode: 1, binaryPath: dockerPath, shell: false, fallbackUsed: false };
          }
          return { stdout: "", stderr: "", exitCode: 0, binaryPath: path.join(tempDir, "pnpm"), shell: false, fallbackUsed: false };
        },
        writeMergedEnvFile: async () => ({ envFilePath: path.join(repoPath, ".env"), created: true, changed: true, addedKeys: ["TELEGRAM_BOT_TOKEN"], preservedKeys: [] }),
        fetchTelegramBotIdentity: async () => ({ ok: true, username: "happytg_bot" }),
        configureBackgroundMode: async ({ mode }) => ({ mode, status: "skipped", detail: "Background daemon setup was skipped." })
      }
    });

    assert.equal(result.launch.status, "failed");
    assert.match(result.launch.detail, /daemon\/Desktop is unavailable/);
    assert.match(result.launch.nextSteps.join("\n"), /Start Docker Desktop|docker info/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("interactive Docker launch receives Mini App port override saved by port preflight", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-docker-port-preflight-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;
  let dockerLaunchMiniAppPort: string | undefined;

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, ".env.example"), "TELEGRAM_BOT_TOKEN=\nHAPPYTG_MINIAPP_PORT=3001\n", "utf8");
    const install = runHappyTGInstall({
      json: false,
      nonInteractive: false,
      cwd: tempDir,
      launchCwd: tempDir,
      bootstrapRepoRoot: REPO_ROOT,
      repoDir: repoPath,
      repoUrl: primarySource.url,
      branch: "main",
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      launchMode: "docker",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        return setupReportWithPorts({
          status: setupCall === 1 ? "warn" : "pass",
          findings: setupCall === 1 ? [{ code: "MINIAPP_PORT_BUSY", severity: "warn", message: "Mini App plans to use port 3001, but another process is already there." }] : [],
          ports: setupCall === 1
            ? [{ id: "miniapp", label: "Mini App", port: 3001, state: "occupied_external", detail: "Mini App plans to use port 3001, but another process is already there.", overrideEnv: "HAPPYTG_MINIAPP_PORT", suggestedPort: 3002, suggestedPorts: [3002, 3003, 3004] }]
            : [{ id: "miniapp", label: "Mini App", port: 3002, state: "free", detail: "Mini App plans to use port 3002; it is free.", overrideEnv: "HAPPYTG_MINIAPP_PORT" }]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: { ...baseEnvironment().platform, isInteractiveTerminal: true }
        }),
        readInstallDraft: async () => undefined,
        detectRepoModeChoices: async () => ({
          clonePath: repoPath,
          currentInspection: repoInspection(tempDir),
          updateInspection: repoInspection(repoPath, { exists: true, isRepo: true, emptyDirectory: false, rootPath: repoPath }),
          choices: [{ mode: "update" as const, label: "Update existing checkout", path: repoPath, available: true, detail: "Existing checkout is ready to update." }]
        }),
        syncRepository: async () => ({ path: repoPath, sync: "updated", repoSource: "primary", repoUrl: primarySource.url, attempts: 1, fallbackUsed: false }),
        resolveExecutable: async (command) => command === "pnpm" ? path.join(tempDir, "pnpm") : undefined,
        runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0, binaryPath: path.join(tempDir, "pnpm"), shell: false, fallbackUsed: false }),
        fetchTelegramBotIdentity: async () => ({ ok: true, username: "happytg_bot" }),
        configureBackgroundMode: async ({ mode }) => ({ mode, status: "skipped", detail: "Background daemon setup was skipped." }),
        runDockerLaunch: async ({ repoEnv }) => {
          dockerLaunchMiniAppPort = repoEnv.HAPPYTG_MINIAPP_PORT;
          return {
            mode: "docker",
            status: "started",
            detail: "Docker Compose control-plane stack started. Host daemon still runs outside Docker.",
            composeFile: "infra/docker-compose.example.yml",
            command: "docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d",
            commands: [],
            health: [],
            warnings: [],
            nextSteps: []
          };
        }
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Port Conflict");
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "enter" });
    const result = await install;

    assert.equal(setupCall, 2);
    assert.equal(result.launch.mode, "docker");
    assert.equal(dockerLaunchMiniAppPort, "3002");
    assert.match(await readFile(path.join(repoPath, ".env"), "utf8"), /HAPPYTG_MINIAPP_PORT=3002/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

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

test("syncRepository updates an existing checkout via the fetched commit without checking out the target branch", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-sync-detached-update-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const commands: string[][] = [];

  try {
    const result = await syncRepository({
      selection: {
        mode: "update",
        path: repoPath,
        dirtyStrategy: "keep"
      },
      sources: [primarySource],
      branch: "main",
      currentInspection: repoInspection(tempDir),
      updateInspection: repoInspection(repoPath, {
        exists: true,
        isRepo: true,
        rootPath: repoPath
      }),
      maxAttempts: 1,
      retryDelayMs: 0,
      runCommandImpl: async ({ args }) => {
        const normalizedArgs = [...(args ?? [])];
        commands.push(normalizedArgs);

        if (normalizedArgs[2] === "fetch") {
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            binaryPath: "git",
            shell: false,
            fallbackUsed: false
          };
        }

        if (normalizedArgs[2] === "rev-parse") {
          return {
            stdout: "1234567890abcdef1234567890abcdef12345678\n",
            stderr: "",
            exitCode: 0,
            binaryPath: "git",
            shell: false,
            fallbackUsed: false
          };
        }

        if (normalizedArgs[2] === "checkout") {
          assert.deepEqual(normalizedArgs, ["-C", repoPath, "checkout", "--detach", "1234567890abcdef1234567890abcdef12345678"]);
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            binaryPath: "git",
            shell: false,
            fallbackUsed: false
          };
        }

        assert.fail(`Unexpected git invocation: ${normalizedArgs.join(" ")}`);
      }
    });

    assert.equal(result.sync, "updated");
    assert.equal(result.path, repoPath);
    assert.deepEqual(commands, [
      ["-C", repoPath, "fetch", "--prune", primarySource.url, "main"],
      ["-C", repoPath, "rev-parse", "--verify", "FETCH_HEAD^{commit}"],
      ["-C", repoPath, "checkout", "--detach", "1234567890abcdef1234567890abcdef12345678"]
    ]);
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

test("runHappyTGInstall classifies ignored build scripts as warning-only when the critical tsx/esbuild path stays healthy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-ignored-build-warning-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const { commandCalls, result } = await runInstallWithPnpmBehavior({
      tempDir,
      repoPath,
      installStdout: [
        "Progress: resolved 31, reused 5, downloaded 0, added 5, done",
        "",
        "The following dependencies have build scripts that were ignored: esbuild",
        "To allow the execution of build scripts for these packages, add their names to \"pnpm.onlyBuiltDependencies\" in your \"package.json\", then run \"pnpm rebuild\""
      ].join("\n")
    });

    assert.equal(result.status, "warn", JSON.stringify(result, null, 2));
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.equal(result.steps.find((step) => step.id === "pnpm-install")?.status, "warn");
    assert.match(result.steps.find((step) => step.id === "pnpm-install")?.detail ?? "", /ignored build scripts/i);
    assert.match(result.warnings.join("\n"), /critical `tsx` \+ `esbuild` path is usable/i);
    assert.equal(result.finalization?.items.some((item) => item.id === "pnpm-ignored-build-scripts" && item.kind === "warning") ?? false, true);
    assert.equal((result.reportJson as { pnpmInstall?: { ignoredBuildScripts?: { approveBuildsSupported?: boolean } } }).pnpmInstall?.ignoredBuildScripts?.approveBuildsSupported, false);
    assert.equal(commandCalls.some((args) => args[0] === "--version"), true);
    assert.equal(commandCalls.some((args) => args[0] === "help" && args[1] === "approve-builds"), true);
    assert.equal(commandCalls.some((args) => args[0] === "exec" && args[1] === "tsx"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall fails honestly when ignored build scripts leave the critical tsx/esbuild path broken", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-ignored-build-broken-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const { result } = await runInstallWithPnpmBehavior({
      tempDir,
      repoPath,
      installStderr: [
        "Warning:",
        "Ignored build scripts: esbuild@0.27.7.",
        "Run \"pnpm approve-builds\" to pick which dependencies should be allowed to run scripts."
      ].join("\n"),
      toolchainExitCode: 1,
      toolchainStderr: "tsx failed because esbuild could not load its binary"
    });

    assert.equal(result.status, "fail", JSON.stringify(result, null, 2));
    assert.equal(result.outcome, "recoverable-failure");
    assert.equal(result.error?.code, "pnpm_install_failed");
    assert.match(result.error?.message ?? "", /critical tsx\/esbuild toolchain unusable/i);
    assert.match(result.error?.lastError ?? "", /ignored build scripts/i);
    assert.match(result.error?.lastError ?? "", /tsx failed because esbuild could not load its binary/i);
    assert.match(result.error?.suggestedAction ?? "", /does not support `pnpm approve-builds`/i);
    assert.equal(result.steps.find((step) => step.id === "pnpm-install")?.status, "failed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps the no-warning pnpm install path unchanged", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-no-warning-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const { commandCalls, result } = await runInstallWithPnpmBehavior({
      tempDir,
      repoPath,
      installStdout: "Lockfile is up to date, resolution step is skipped."
    });

    assert.equal(result.status, "pass", JSON.stringify(result, null, 2));
    assert.equal(result.outcome, "success");
    assert.equal(result.steps.find((step) => step.id === "pnpm-install")?.status, "passed");
    assert.equal(result.finalization?.items.some((item) => item.id === "pnpm-ignored-build-scripts") ?? false, false);
    assert.equal(result.warnings.length, 0);
    assert.equal(commandCalls.some((args) => args[0] === "--version"), false);
    assert.equal(commandCalls.some((args) => args[0] === "help" && args[1] === "approve-builds"), false);
    assert.equal(commandCalls.some((args) => args[0] === "exec" && args[1] === "tsx"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall uses approve-builds guidance only when the runtime pnpm exposes that command", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-approve-builds-guidance-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const { result } = await runInstallWithPnpmBehavior({
      tempDir,
      repoPath,
      installStderr: [
        "Warning:",
        "Ignored build scripts: esbuild@0.27.7.",
        "Run \"pnpm approve-builds\" to pick which dependencies should be allowed to run scripts."
      ].join("\n"),
      pnpmVersion: "10.1.0",
      helpOutput: "Version 10.1.0\nUsage: pnpm approve-builds\n"
    });

    const warningItem = result.finalization?.items.find((item) => item.id === "pnpm-ignored-build-scripts");
    assert.equal(result.status, "warn", JSON.stringify(result, null, 2));
    assert.equal((result.reportJson as { pnpmInstall?: { ignoredBuildScripts?: { approveBuildsSupported?: boolean; pnpmVersion?: string } } }).pnpmInstall?.ignoredBuildScripts?.approveBuildsSupported, true);
    assert.equal((result.reportJson as { pnpmInstall?: { ignoredBuildScripts?: { approveBuildsSupported?: boolean; pnpmVersion?: string } } }).pnpmInstall?.ignoredBuildScripts?.pnpmVersion, "10.1.0");
    assert.match((warningItem?.solutions ?? []).join("\n"), /pnpm approve-builds/);
    assert.match(result.steps.find((step) => step.id === "pnpm-install")?.detail ?? "", /approve-builds` is available/i);
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

test("runHappyTGInstall treats a transport-probe-validated Telegram identity as a normal success path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-telegram-validated-"));
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
          addedKeys: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "gerta_homebot",
          transportProbeValidated: true
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "configured",
          detail: "Configured by test."
        })
      }
    });

    assert.equal(result.status, "pass");
    assert.equal(result.outcome, "success");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.telegram.bot?.ok, true);
    assert.equal(result.telegram.bot?.username, "gerta_homebot");
    assert.equal(result.telegram.bot?.transportProbeValidated, true);
    assert.equal(result.telegram.lookup?.status, "validated");
    assert.match(result.telegram.lookup?.message ?? "", /validated @gerta_homebot/i);
    assert.match(result.steps.find((step) => step.id === "telegram-bot")?.detail ?? "", /Connected to @gerta_homebot/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps invalid Telegram tokens as configuration failures after a transport fallback probe", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-telegram-invalid-"));
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
          error: "Telegram API getMe rejected the configured token: Unauthorized. Node HTTPS also failed earlier with: Connection to api.telegram.org timed out. This means Telegram was reachable through a second transport, but the token itself is invalid.",
          step: "getMe",
          failureKind: "invalid_token",
          recoverable: false,
          statusCode: 401
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
    assert.equal(result.telegram.bot?.ok, false);
    assert.equal(result.telegram.bot?.failureKind, "invalid_token");
    assert.equal(result.telegram.lookup?.status, "failed");
    assert.equal(result.telegram.lookup?.failureKind, "invalid_token");
    assert.equal(result.telegram.lookup?.affectsConfiguration, true);
    assert.match(result.error?.lastError ?? "", /token itself is invalid/i);
    assert.match(result.steps.find((step) => step.id === "telegram-bot")?.detail ?? "", /rejected the configured token/i);
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
    await waitForOutput("Launch Mode");
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

test("runHappyTGInstall releases stdin after ENTER closes the final summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-final-summary-exit-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const transcript: string[] = [];
  let pauseCalls = 0;
  let resumeCalls = 0;

  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream & { setRawMode: (value: boolean) => void; isTTY: boolean };
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream & { isTTY: boolean };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = ((_: boolean) => stdin) as typeof stdin.setRawMode;
  const originalPause = stdin.pause.bind(stdin);
  const originalResume = stdin.resume.bind(stdin);
  stdin.pause = (() => {
    pauseCalls += 1;
    return originalPause();
  }) as typeof stdin.pause;
  stdin.resume = (() => {
    resumeCalls += 1;
    return originalResume();
  }) as typeof stdin.resume;
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
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME="
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
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
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background launcher setup was skipped."
        })
      }
    });

    await waitForOutput("Welcome / Preflight");
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Repo Mode");
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Telegram Setup");
    await emitKeypress("", { name: "down" });
    await emitKeypress("", { name: "down" });
    await emitKeypress("", { name: "down" });
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Background Run Mode");
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Launch Mode");
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Post-Install Checks");
    await emitKeypress("\r", { name: "enter" });
    await waitForOutput("Final Summary");
    await emitKeypress("\r", { name: "enter" });

    const result = await install;
    assert.equal(result.status, "pass");
    assert.ok(resumeCalls >= 1);
    assert.ok(pauseCalls >= 1);
    assert.equal(stdin.isPaused(), true);
    assert.equal(stdin.listenerCount("keypress"), 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight offers three suggested ports and saves the selected override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-suggested-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_MINIAPP_PORT=3001",
        "HAPPYTG_APP_URL=http://localhost:3001",
        "HAPPYTG_DEV_CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        if (setupCall === 1) {
          return setupReportWithPorts({
            status: "warn",
            findings: [
              {
                code: "MINIAPP_PORT_BUSY",
                severity: "warn",
                message: "Mini App plans to use port 3001, but HTTP listener (Contacts) is already there."
              }
            ],
            ports: [
              {
                id: "miniapp",
                label: "Mini App",
                port: 3001,
                state: "occupied_external",
                detail: "Mini App plans to use port 3001, but HTTP listener (Contacts) is already there.",
                overrideEnv: "HAPPYTG_MINIAPP_PORT",
                suggestedPort: 3002,
                suggestedPorts: [3002, 3003, 3004],
                listener: {
                  description: "HTTP listener (Contacts)"
                }
              }
            ]
          });
        }

        return setupReportWithPorts({
          status: "pass",
          ports: [
            {
              id: "miniapp",
              label: "Mini App",
              port: 3002,
              state: "free",
              detail: "Mini App plans to use port 3002; it is free.",
              overrideEnv: "HAPPYTG_MINIAPP_PORT",
              suggestedPort: 3003,
              suggestedPorts: [3003, 3004, 3005]
            }
          ]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    const conflictScreen = await harness.waitForOutput("Port Conflict");
    assert.match(conflictScreen, /3002, 3003, 3004/);
    assert.match(conflictScreen, /HTTP listener \(Contacts\)/);
    assert.match(conflictScreen, /HAPPYTG_MINIAPP_PORT/);
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "enter" });

    const result = await install;
    const envText = await readFile(path.join(repoPath, ".env"), "utf8");

    assert.equal(setupCall, 2);
    assert.equal(result.status, "pass");
    assert.match(envText, /HAPPYTG_MINIAPP_PORT=3002/);
    assert.match(envText, /HAPPYTG_APP_URL=http:\/\/localhost:3002/);
    assert.match(envText, /HAPPYTG_DEV_CORS_ORIGINS=http:\/\/localhost:3002,http:\/\/127\.0\.0\.1:3002/);
    assert.equal(result.finalization?.items.some((item) => item.id === "port-preflight-miniapp" && item.kind === "auto"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight shows progress while saving the selected override and rerunning preflight", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-progress-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;
  let releaseSecondSetup: (() => void) | undefined;
  const secondSetupGate = new Promise<void>((resolve) => {
    releaseSecondSetup = resolve;
  });

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_MINIAPP_PORT=3001"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        if (setupCall === 1) {
          return setupReportWithPorts({
            status: "warn",
            findings: [
              {
                code: "MINIAPP_PORT_BUSY",
                severity: "warn",
                message: "Mini App plans to use port 3001, but another process is already there."
              }
            ],
            ports: [
              {
                id: "miniapp",
                label: "Mini App",
                port: 3001,
                state: "occupied_external",
                detail: "Mini App plans to use port 3001, but another process is already there.",
                overrideEnv: "HAPPYTG_MINIAPP_PORT",
                suggestedPort: 3002,
                suggestedPorts: [3002, 3003, 3004],
                listener: {
                  description: "HTTP listener (Contacts)"
                }
              }
            ]
          });
        }

        await secondSetupGate;
        return setupReportWithPorts({
          status: "pass",
          ports: [
            {
              id: "miniapp",
              label: "Mini App",
              port: 3002,
              state: "free",
              detail: "Mini App plans to use port 3002; it is free.",
              overrideEnv: "HAPPYTG_MINIAPP_PORT"
            }
          ]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Port Conflict");
    await harness.emitKeypress("\r", { name: "enter" });
    const progressScreen = await harness.waitForOutput(/Saving `HAPPYTG_MINIAPP_PORT=3002`/);
    const latestProgressScreen = (progressScreen.split("\u001B[2J\u001B[H").at(-1) ?? progressScreen)
      .replace(/\u001b\[[0-9;]*m/gu, "");

    assert.match(progressScreen, /Resolve planned ports/);
    assert.match(progressScreen, /Re-running planned port preflight so the installer can continue/);
    assert.doesNotMatch(progressScreen, /Final Summary/);
    assert.match(latestProgressScreen, /\[####------\] 3\/7 steps complete/);

    releaseSecondSetup?.();
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "enter" });

    const result = await install;
    assert.equal(result.status, "pass");
    assert.equal(setupCall, 2);
  } finally {
    releaseSecondSetup?.();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight accepts a manual port override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-manual-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;
  const customPort = 3555;

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_MINIAPP_PORT=3001"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        if (setupCall === 1) {
          return setupReportWithPorts({
            status: "warn",
            findings: [
              {
                code: "MINIAPP_PORT_BUSY",
                severity: "warn",
                message: "Mini App plans to use port 3001, but another process is already there."
              }
            ],
            ports: [
              {
                id: "miniapp",
                label: "Mini App",
                port: 3001,
                state: "occupied_external",
                detail: "Mini App plans to use port 3001, but another process is already there.",
                overrideEnv: "HAPPYTG_MINIAPP_PORT",
                suggestedPort: 3002,
                suggestedPorts: [3002, 3003, 3004],
                listener: {
                  description: "HTTP listener (Contacts)"
                }
              }
            ]
          });
        }

        return setupReportWithPorts({
          status: "pass",
          ports: [
            {
              id: "miniapp",
              label: "Mini App",
              port: customPort,
              state: "free",
              detail: `Mini App plans to use port ${customPort}; it is free.`,
              overrideEnv: "HAPPYTG_MINIAPP_PORT"
            }
          ]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Port Conflict");
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Custom Port");
    await harness.emitKeypress(String(customPort));
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "enter" });

    const result = await install;
    const envText = await readFile(path.join(repoPath, ".env"), "utf8");

    assert.equal(setupCall, 2);
    assert.equal(result.status, "pass");
    assert.match(envText, new RegExp(`HAPPYTG_MINIAPP_PORT=${customPort}`));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight keeps the custom-port prompt active after invalid input and then accepts enter-confirmed retry", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-manual-validation-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;
  const customPort = 3556;

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_MINIAPP_PORT=3001"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        if (setupCall === 1) {
          return setupReportWithPorts({
            status: "warn",
            findings: [
              {
                code: "MINIAPP_PORT_BUSY",
                severity: "warn",
                message: "Mini App plans to use port 3001, but another process is already there."
              }
            ],
            ports: [
              {
                id: "miniapp",
                label: "Mini App",
                port: 3001,
                state: "occupied_external",
                detail: "Mini App plans to use port 3001, but another process is already there.",
                overrideEnv: "HAPPYTG_MINIAPP_PORT",
                suggestedPort: 3002,
                suggestedPorts: [3002, 3003, 3004],
                listener: {
                  description: "HTTP listener (Contacts)"
                }
              }
            ]
          });
        }

        return setupReportWithPorts({
          status: "pass",
          ports: [
            {
              id: "miniapp",
              label: "Mini App",
              port: customPort,
              state: "free",
              detail: `Mini App plans to use port ${customPort}; it is free.`,
              overrideEnv: "HAPPYTG_MINIAPP_PORT"
            }
          ]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Port Conflict");
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Custom Port");
    await harness.emitKeypress("3001");
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput(/Port 3001 is already occupied for Mini App/);
    await harness.emitKeypress("", { name: "backspace" });
    await harness.emitKeypress("", { name: "backspace" });
    await harness.emitKeypress("", { name: "backspace" });
    await harness.emitKeypress("", { name: "backspace" });
    await harness.emitKeypress(String(customPort));
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "enter" });

    const result = await install;
    const envText = await readFile(path.join(repoPath, ".env"), "utf8");

    assert.equal(setupCall, 2);
    assert.equal(result.status, "pass");
    assert.match(envText, new RegExp(`HAPPYTG_MINIAPP_PORT=${customPort}`));
    assert.match(harness.transcriptText(), /Validation/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight skips port changes for supported reuse", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-reuse-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();
  let setupCall = 0;

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_API_PORT=4000"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => {
        setupCall += 1;
        return setupReportWithPorts({
          status: "pass",
          ports: [
            {
              id: "api",
              label: "API",
              port: 4000,
              state: "occupied_expected",
              detail: "API plans to use port 4000, and HappyTG api is already running there.",
              overrideEnv: "HAPPYTG_API_PORT",
              service: "api",
              listener: {
                description: "HappyTG api",
                service: "api"
              }
            }
          ]
        });
      },
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Final Summary");
    await harness.emitKeypress("\r", { name: "return" });

    const result = await install;
    const envText = await readFile(path.join(repoPath, ".env"), "utf8");

    assert.equal(setupCall, 1);
    assert.doesNotMatch(harness.transcriptText(), /Port Conflict/);
    assert.equal(result.status, "pass");
    assert.match(envText, /HAPPYTG_API_PORT=4000/);
    assert.equal(result.finalization?.items.some((item) => item.id === "port-preflight-api"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall interactive port preflight can abort instead of silently rebinding", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-port-abort-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const harness = createInteractiveHarness();

  try {
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, ".env.example"),
      [
        "TELEGRAM_BOT_TOKEN=",
        "TELEGRAM_ALLOWED_USER_IDS=",
        "TELEGRAM_HOME_CHANNEL=",
        "TELEGRAM_BOT_USERNAME=",
        "HAPPYTG_MINIAPP_PORT=3001"
      ].join("\n"),
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
      telegramBotToken: "123456:abcdefghijklmnopqrstuvwx",
      telegramAllowedUserIds: [],
      backgroundMode: "skip",
      postChecks: []
    }, {
      stdin: harness.stdin,
      stdout: harness.stdout,
      runBootstrapCheck: async () => setupReportWithPorts({
        status: "warn",
        findings: [
          {
            code: "MINIAPP_PORT_BUSY",
            severity: "warn",
            message: "Mini App plans to use port 3001, but another process is already there."
          }
        ],
        ports: [
          {
            id: "miniapp",
            label: "Mini App",
            port: 3001,
            state: "occupied_external",
            detail: "Mini App plans to use port 3001, but another process is already there.",
            overrideEnv: "HAPPYTG_MINIAPP_PORT",
            suggestedPort: 3002,
            suggestedPorts: [3002, 3003, 3004],
            listener: {
              description: "HTTP listener (Contacts)"
            }
          }
        ]
      }),
      deps: {
        detectInstallerEnvironment: async () => ({
          ...baseEnvironment(),
          platform: {
            ...baseEnvironment().platform,
            isInteractiveTerminal: true
          }
        }),
        readInstallDraft: async () => undefined,
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
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    await advanceInteractiveInstallToPortPreflight(harness);
    await harness.waitForOutput("Port Conflict");
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("", { name: "down" });
    await harness.emitKeypress("\r", { name: "enter" });
    await harness.waitForOutput("Needs Attention");
    await harness.emitKeypress("\r", { name: "enter" });

    const result = await install;
    const envText = await readFile(path.join(repoPath, ".env"), "utf8");

    assert.equal(result.status, "fail");
    assert.equal(result.outcome, "recoverable-failure");
    assert.match(result.error?.message ?? "", /port conflict was left unresolved/i);
    assert.doesNotMatch(envText, /HAPPYTG_MINIAPP_PORT=3002/);
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
    assert.match(renderText(result), /Telegram: @known_happytg_bot/);
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
    const codexProblem = "Codex CLI is usable, but the npm global bin directory is not on PATH in the current shell yet.";
    const codexSolutions = [
      "Add the npm global bin directory to PATH.",
      "Restart the shell.",
      "Verify `codex --version`."
    ];
    const codexOnboardingItem: AutomationItem = {
      id: "codex-path-pending",
      kind: "warning",
      message: codexProblem,
      solutions: codexSolutions
    };
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
        planPreview: legacyPlanPreviewFromAutomation([codexOnboardingItem]),
        reportJson: reportJsonWithOnboarding([codexOnboardingItem]),
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
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 0);
    const codexFinalizationItem = result.finalization?.items.find((item) => item.id === "codex-path-pending" && item.kind === "warning");
    assert.deepEqual(codexFinalizationItem, codexOnboardingItem);
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    assert.equal(result.steps.filter((step) => step.id.startsWith("check-")).every((step) => step.status === "warn"), true);
    const rendered = renderText(result);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexProblem).length - 1, 1);
    for (const solution of codexSolutions) {
      assert.equal(rendered.split(solution).length - 1, 1);
    }
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
    const codexProblem = "Codex CLI is usable, but the npm global bin directory is not on PATH in the current shell yet.";
    const codexSolutions = [
      "Add the npm global bin directory to PATH.",
      "Restart the shell.",
      "Verify `codex --version`."
    ];
    const codexOnboardingItem: AutomationItem = {
      id: "codex-path-pending",
      kind: "warning",
      message: codexProblem,
      solutions: codexSolutions
    };
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
        planPreview: legacyPlanPreviewFromAutomation([codexOnboardingItem]),
        reportJson: reportJsonWithOnboarding([codexOnboardingItem]),
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
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 0);
    const codexFinalizationItem = result.finalization?.items.find((item) => item.id === "codex-path-pending" && item.kind === "warning");
    assert.deepEqual(codexFinalizationItem, codexOnboardingItem);
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    const rendered = renderText(result);
    assert.equal(rendered.split(telegramWarning).length - 1, 1);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexProblem).length - 1, 1);
    for (const solution of codexSolutions) {
      assert.equal(rendered.split(solution).length - 1, 1);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall semantically dedupes repeated setup next steps and compresses repeated post-check warning sets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-semantic-dedupe-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");

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
        reportJson: reportJsonWithOnboarding([
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
            message: "Send `/pair <CODE>` to Telegram."
          },
          {
            id: "start-daemon",
            kind: "manual",
            message: "After pairing, start the daemon with `pnpm dev:daemon`."
          }
        ]),
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

    assert.equal(result.nextSteps.some((step) => step === "pnpm dev"), false);
    assert.equal(result.nextSteps.filter((step) => step === "Start repo services: `pnpm dev`.").length, 1);
    assert.equal(
      result.nextSteps.filter((step) => step === "The installer could not request a pairing code automatically. When the HappyTG API is reachable, request one manually with `pnpm daemon:pair`.").length,
      1
    );
    assert.equal(
      result.nextSteps.filter((step) => step === "If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command to @happytg_bot.").length,
      1
    );
    assert.equal(result.finalization?.items.filter((item) => item.id === "start-repo-services" && item.kind === "manual").length, 1);
    assert.equal(result.finalization?.items.filter((item) => item.id === "request-pair-code" && item.kind === "manual").length, 1);
    assert.equal(result.finalization?.items.filter((item) => item.id === "pairing-auto-request" && item.kind === "warning").length, 1);
    assert.match(result.steps.find((step) => step.id === "check-setup")?.detail ?? "", /Codex CLI completed the smoke check with warnings/i);
    assert.equal(result.steps.find((step) => step.id === "check-doctor")?.detail, "No new warnings beyond `setup`; the same warning set was confirmed.");
    assert.equal(result.steps.find((step) => step.id === "check-verify")?.detail, "No new warnings beyond `setup`; the same warning set was confirmed.");
    assert.match(result.postChecks[1]?.summary ?? "", /Same warning set as setup/i);
    assert.match(result.postChecks[2]?.summary ?? "", /Same warning set as setup/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall removes contradictory start commands when setup already says to reuse the running stack", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-running-stack-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");

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
      backgroundMode: "scheduled-task",
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "SERVICES_ALREADY_RUNNING",
            severity: "info",
            message: "HappyTG services already appear to be running on 4000. Reuse the running stack or stop it before starting another copy."
          }
        ],
        planPreview: [
          "Redis, PostgreSQL, and S3-compatible storage already look reachable locally. Reuse them and skip Docker shared infra entirely.",
          "Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy.",
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to Telegram.",
          "If you keep mini app on a different port, use `$env:HAPPYTG_MINIAPP_PORT=\"3006\"; pnpm dev:miniapp`."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "shared-infra-ready",
            kind: "reuse",
            message: "Redis, PostgreSQL, and S3-compatible storage already look reachable locally. Reuse them and skip Docker shared infra entirely."
          },
          {
            id: "running-stack-reuse",
            kind: "reuse",
            message: "Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy."
          },
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to Telegram."
          },
          {
            id: "miniapp-port-conflict",
            kind: "conflict",
            message: "If you keep mini app on a different port, use `$env:HAPPYTG_MINIAPP_PORT=\"3006\"; pnpm dev:miniapp`."
          }
        ]),
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
        writeInstallDraft: async ({ draft }) => ({
          ...draft,
          version: 1,
          updatedAt: draft.updatedAt ?? "2026-04-17T00:00:00.000Z"
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

    assert.equal(result.nextSteps.includes("pnpm dev"), false);
    assert.equal(
      result.nextSteps.filter((step) => step === "The installer could not request a pairing code automatically. When the HappyTG API is reachable, request one manually with `pnpm daemon:pair`.").length,
      1
    );
    assert.equal(result.finalization?.items.filter((item) => item.id === "shared-infra-ready" && item.kind === "reuse").length, 1);
    assert.equal(result.finalization?.items.filter((item) => item.id === "running-stack-reuse" && item.kind === "reuse").length, 1);
    assert.equal(result.finalization?.items.some((item) => item.id === "start-repo-services"), false);
    assert.equal(result.finalization?.items.some((item) => item.message === "Redis is already running. Use it and skip compose `redis` unless you deliberately remap the host port."), false);
    assert.equal(result.finalization?.items.some((item) => item.message === "Do not run the full compose app stack and `pnpm dev` at the same time."), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall auto-requests a pairing code and suppresses the manual request step once the code is available", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-auto-pair-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");

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
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [],
        planPreview: [
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to @happytg_bot."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to @happytg_bot."
          }
        ]),
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
        runCommand: async ({ args }) => ({
          stdout: args?.[0] === "daemon:pair"
            ? "Pair this host by sending /pair ABC123 to @happytg_bot\nHost ID: host_test\nExpires at: 2026-04-17T12:00:00.000Z\n"
            : "",
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
          preservedKeys: ["HAPPYTG_STATE_DIR"]
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

    assert.equal(result.finalization?.items.filter((item) => item.id === "request-pair-code" && item.kind === "auto").length, 1);
    assert.equal(result.finalization?.items.filter((item) => item.id === "complete-pairing" && item.message === "Send `/pair ABC123` to @happytg_bot.").length, 1);
    assert.equal(result.nextSteps.some((step) => step === "Request a pairing code on the execution host: `pnpm daemon:pair`."), false);
    assert.equal(result.nextSteps.filter((step) => step === "Send `/pair ABC123` to @happytg_bot.").length, 1);
    assert.equal(result.nextSteps.filter((step) => step === "After pairing, start the daemon with `pnpm dev:daemon`.").length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall refreshes the pairing code automatically when an existing local host is still registering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-refresh-pair-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");
  await writeFile(path.join(stateDir, "daemon-state.json"), JSON.stringify({
    hostId: "host_existing",
    fingerprint: "fp-existing",
    apiBaseUrl: "http://127.0.0.1:4000"
  }, null, 2), "utf8");

  try {
    const daemonPairCalls: string[][] = [];
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
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [],
        planPreview: [
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to @happytg_bot."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to @happytg_bot."
          }
        ]),
        createdAt: "2026-04-19T00:00:00.000Z"
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
        runCommand: async ({ args }) => {
          if (args?.[0] === "daemon:pair") {
            daemonPairCalls.push(args);
          }
          return {
            stdout: args?.[0] === "daemon:pair"
              ? "Pair this host by sending /pair REFRESH123 to @happytg_bot\nHost ID: host_existing\nExpires at: 2026-04-19T12:00:00.000Z\n"
              : "",
            stderr: "",
            exitCode: 0,
            binaryPath: path.join(tempDir, "pnpm"),
            shell: false,
            fallbackUsed: false
          };
        },
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: ["HAPPYTG_STATE_DIR"]
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        fetchPairingHostStatus: async ({ hostId }) => ({
          hostId,
          status: "registering",
          apiBaseUrl: "http://127.0.0.1:4000"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "manual",
          detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(daemonPairCalls.length, 1);
    assert.equal(result.finalization?.items.filter((item) => item.id === "request-pair-code" && item.kind === "auto").length, 1);
    assert.equal(result.finalization?.items.find((item) => item.id === "request-pair-code")?.message, "Refreshed the existing host pairing code on the execution host. It expires at 2026-04-19T12:00:00.000Z.");
    assert.equal(result.finalization?.items.find((item) => item.id === "complete-pairing")?.message, "Send `/pair REFRESH123` to @happytg_bot.");
    assert.equal(result.finalization?.items.some((item) => item.id === "pairing-auto-request"), false);
    assert.equal(result.nextSteps.some((step) => step === "Request a pairing code on the execution host: `pnpm daemon:pair`."), false);
    assert.equal(result.nextSteps.filter((step) => step === "Send `/pair REFRESH123` to @happytg_bot.").length, 1);
    assert.equal(result.nextSteps.filter((step) => step === "After pairing, start the daemon with `pnpm dev:daemon`.").length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall reuses an already paired existing host without requesting a fresh pairing code", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-reuse-paired-host-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");
  await writeFile(path.join(stateDir, "daemon-state.json"), JSON.stringify({
    hostId: "host_active",
    fingerprint: "fp-active",
    apiBaseUrl: "http://127.0.0.1:4000"
  }, null, 2), "utf8");

  try {
    let daemonPairCalls = 0;
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
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [],
        planPreview: [
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to @happytg_bot."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to @happytg_bot."
          }
        ]),
        createdAt: "2026-04-19T00:00:00.000Z"
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
        runCommand: async ({ args }) => {
          if (args?.[0] === "daemon:pair") {
            daemonPairCalls += 1;
          }
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            binaryPath: path.join(tempDir, "pnpm"),
            shell: false,
            fallbackUsed: false
          };
        },
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: ["HAPPYTG_STATE_DIR"]
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        fetchPairingHostStatus: async ({ hostId }) => ({
          hostId,
          status: "active",
          apiBaseUrl: "http://127.0.0.1:4000"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "manual",
          detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(daemonPairCalls, 0);
    assert.equal(result.finalization?.items.find((item) => item.id === "request-pair-code")?.kind, "reuse");
    assert.match(result.finalization?.items.find((item) => item.id === "request-pair-code")?.message ?? "", /reports this host as active/i);
    assert.equal(result.finalization?.items.some((item) => item.id === "complete-pairing"), false);
    assert.equal(result.nextSteps.some((step) => step === "Request a pairing code on the execution host: `pnpm daemon:pair`."), false);
    assert.equal(result.nextSteps.some((step) => /\/pair <CODE>|\/pair [A-Z0-9-]+/u.test(step)), false);
    assert.equal(result.nextSteps.filter((step) => step === "Start the daemon with `pnpm dev:daemon`.").length, 1);
    assert.equal(result.nextSteps.some((step) => step === "After pairing, start the daemon with `pnpm dev:daemon`."), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall keeps pairing blocked and skips code requests when Telegram token validation fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-blocked-pairing-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    let daemonPairCalls = 0;
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
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [],
        planPreview: [
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to @happytg_bot."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to @happytg_bot."
          }
        ]),
        createdAt: "2026-04-19T00:00:00.000Z"
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
        runCommand: async ({ args }) => {
          if (args?.[0] === "daemon:pair") {
            daemonPairCalls += 1;
          }
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            binaryPath: path.join(tempDir, "pnpm"),
            shell: false,
            fallbackUsed: false
          };
        },
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: []
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: false,
          error: "Telegram API getMe rejected the token with HTTP 401 Unauthorized.",
          step: "getMe",
          failureKind: "invalid_token",
          recoverable: false,
          statusCode: 401
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "manual",
          detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(daemonPairCalls, 0);
    assert.equal(result.finalization?.items.find((item) => item.id === "request-pair-code")?.kind, "blocked");
    assert.equal(result.finalization?.items.find((item) => item.id === "request-pair-code")?.message, "Pairing remains blocked because Telegram bot validation failed.");
    assert.deepEqual(result.finalization?.items.find((item) => item.id === "request-pair-code")?.solutions, [
      "Fix `TELEGRAM_BOT_TOKEN` in `.env` or the shell.",
      "Rerun `pnpm happytg install` after the bot token works."
    ]);
    assert.equal(result.finalization?.items.some((item) => item.id === "complete-pairing"), false);
    assert.equal(result.finalization?.items.some((item) => item.id === "start-daemon"), false);
    assert.equal(result.nextSteps.some((step) => step === "Request a pairing code on the execution host: `pnpm daemon:pair`."), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall renders an honest manual fallback when the existing-host probe is unavailable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-probe-unavailable-"));
  const repoPath = path.join(tempDir, "HappyTG");
  const stateDir = path.join(tempDir, ".happytg-state");
  await mkdir(repoPath, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(repoPath, ".env"), `HAPPYTG_STATE_DIR=${stateDir}\n`, "utf8");
  await writeFile(path.join(stateDir, "daemon-state.json"), JSON.stringify({
    hostId: "host_probe_pending",
    fingerprint: "fp-probe-pending",
    apiBaseUrl: "http://127.0.0.1:4000"
  }, null, 2), "utf8");

  try {
    let daemonPairCalls = 0;
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
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [],
        planPreview: [
          "Request a pairing code on the execution host: `pnpm daemon:pair`.",
          "Send `/pair <CODE>` to @happytg_bot."
        ],
        reportJson: reportJsonWithOnboarding([
          {
            id: "request-pair-code",
            kind: "manual",
            message: "Request a pairing code on the execution host: `pnpm daemon:pair`."
          },
          {
            id: "complete-pairing",
            kind: "manual",
            message: "Send `/pair <CODE>` to @happytg_bot."
          }
        ]),
        createdAt: "2026-04-19T00:00:00.000Z"
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
        runCommand: async ({ args }) => {
          if (args?.[0] === "daemon:pair") {
            daemonPairCalls += 1;
          }
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            binaryPath: path.join(tempDir, "pnpm"),
            shell: false,
            fallbackUsed: false
          };
        },
        writeMergedEnvFile: async () => ({
          envFilePath: path.join(repoPath, ".env"),
          created: false,
          changed: false,
          addedKeys: [],
          preservedKeys: ["HAPPYTG_STATE_DIR"]
        }),
        fetchTelegramBotIdentity: async () => ({
          ok: true,
          username: "happytg_bot"
        }),
        fetchPairingHostStatus: async ({ hostId }) => ({
          hostId,
          status: "unreachable",
          apiBaseUrl: "http://127.0.0.1:4000",
          error: "connect ECONNREFUSED 127.0.0.1:4000"
        }),
        configureBackgroundMode: async ({ mode }) => ({
          mode,
          status: "manual",
          detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(daemonPairCalls, 0);
    assert.equal(result.finalization?.items.find((item) => item.id === "request-pair-code")?.kind, "manual");
    assert.equal(
      result.finalization?.items.find((item) => item.id === "request-pair-code")?.message,
      "The installer could not confirm whether the existing local host is already paired. If this host still needs pairing, request a fresh code manually with `pnpm daemon:pair`."
    );
    assert.equal(
      result.finalization?.items.find((item) => item.id === "complete-pairing")?.message,
      "If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command to @happytg_bot."
    );
    assert.equal(result.finalization?.items.find((item) => item.id === "pairing-auto-request")?.kind, "warning");
    assert.equal(
      result.finalization?.items.find((item) => item.id === "pairing-auto-request")?.message,
      "Existing host daemon state was detected locally, but the installer could not confirm its pairing state automatically."
    );
    assert.equal(
      result.nextSteps.filter((step) => step === "The installer could not confirm whether the existing local host is already paired. If this host still needs pairing, request a fresh code manually with `pnpm daemon:pair`.").length,
      1
    );
    assert.equal(
      result.nextSteps.filter((step) => step === "If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command to @happytg_bot.").length,
      1
    );
    assert.equal(result.nextSteps.filter((step) => step === "After pairing, start the daemon with `pnpm dev:daemon`.").length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall reports requested background automation as a warning when configuration falls back to manual", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-background-fallback-"));
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
      backgroundMode: "scheduled-task",
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
        configureBackgroundMode: async () => ({
          mode: "scheduled-task",
          status: "manual",
          detail: "Scheduled Task setup could not be applied automatically. Start the daemon manually with `pnpm dev:daemon` after pairing."
        })
      }
    });

    assert.equal(result.finalization?.items.filter((item) => item.id === "background-configured" && item.kind === "warning").length, 1);
    assert.equal(result.finalization?.items.some((item) => item.id === "background-configured" && item.kind === "auto"), false);
    assert.match(renderText(result), /Scheduled Task setup could not be applied automatically/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runHappyTGInstall suppresses warning duplicates when the same guidance is already classified as a conflict", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-install-conflict-dedupe-"));
  const repoPath = path.join(tempDir, "HappyTG");
  await mkdir(repoPath, { recursive: true });

  try {
    const conflictMessage = "Mini App plans to use port 3001, but another process is already there.";
    const conflictSolutions = [
      "Reuse the running service if it is yours.",
      "Pick a new port with `$env:HAPPYTG_MINIAPP_PORT=\"3006\"; pnpm dev:miniapp`."
    ];
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
      backgroundMode: "skip",
      postChecks: ["setup"]
    }, {
      runBootstrapCheck: async (command) => ({
        id: `btr_${command}`,
        hostFingerprint: "fp",
        command,
        status: "warn",
        profileRecommendation: "recommended",
        findings: [
          {
            code: "MINIAPP_PORT_BUSY",
            severity: "warn",
            message: conflictMessage
          }
        ],
        planPreview: [conflictMessage],
        reportJson: reportJsonWithOnboarding([
          {
            id: "miniapp-port-conflict",
            kind: "conflict",
            message: conflictMessage,
            solutions: conflictSolutions
          }
        ]),
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
          status: "skipped",
          detail: "Background daemon setup was skipped."
        })
      }
    });

    const rendered = renderText(result);

    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.warnings.includes(conflictMessage), false);
    assert.equal(result.finalization?.items.filter((item) => item.id === "miniapp-port-conflict" && item.kind === "conflict").length, 1);
    assert.deepEqual(result.finalization?.items.find((item) => item.id === "miniapp-port-conflict")?.solutions, conflictSolutions);
    assert.equal(rendered.split(conflictMessage).length - 1, 1);
    assert.equal(rendered.split(conflictSolutions[0]!).length - 1, 1);
    assert.equal(rendered.split(conflictSolutions[1]!).length - 1, 1);
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
    const codexProblem = `Codex CLI is usable, but \`${npmBinDir}\` is not on PATH in the current shell yet.`;
    const codexSolutions = [
      `Add \`${npmBinDir}\` to PATH.`,
      "Restart the shell.",
      "Verify `codex --version`."
    ];

    assert.equal(result.status, "warn");
    assert.equal(result.outcome, "success-with-warnings");
    assert.equal(result.error, undefined);
    assert.equal(result.warnings.filter((warning) => warning === codexWarning).length, 1);
    assert.equal(result.nextSteps.filter((step) => step === codexNextStep).length, 0);
    const codexFinalizationItem = result.finalization?.items.find((item) => item.id === "codex-path-pending" && item.kind === "warning");
    assert.deepEqual(codexFinalizationItem, {
      id: "codex-path-pending",
      kind: "warning",
      message: codexProblem,
      solutions: codexSolutions
    });
    assert.deepEqual(result.postChecks.map((check) => check.status), ["warn", "warn", "warn"]);
    assert.equal(result.steps.filter((step) => step.id.startsWith("check-")).every((step) => step.status === "warn"), true);
    assert.ok(result.postChecks.some((check) => new RegExp(escapedNpmBinDir).test(check.summary)));
    assert.match(rendered, /install flow is complete with warnings/i);
    assert.doesNotMatch(rendered, /install needs follow-up/i);
    assert.doesNotMatch(rendered, /recoverable issues/i);
    assert.equal(rendered.split(codexWarning).length - 1, 1);
    assert.equal(rendered.split(codexProblem).length - 1, 1);
    for (const solution of codexSolutions) {
      assert.equal(rendered.split(solution).length - 1, 1);
    }
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
