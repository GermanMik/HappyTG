import path from "node:path";

import type { BootstrapReport } from "../../../protocol/src/index.js";
import {
  getLocalStateDir,
  nowIso,
  parseDotEnv,
  readTextFileOrEmpty,
  resolveExecutable,
  writeJsonFileAtomic
} from "../../../shared/src/index.js";

import { configureBackgroundMode } from "./background.js";
import { runCommand, runShellCommand } from "./commands.js";
import { writeMergedEnvFile } from "./env.js";
import { detectInstallerEnvironment } from "./platform.js";
import {
  defaultDirtyWorktreeStrategy,
  detectRepoModeChoices,
  pickDefaultRepoMode,
  syncRepository
} from "./repo.js";
import {
  promptMultiSelect,
  promptSelect,
  promptTelegramForm,
  renderBackgroundModeScreen,
  renderDirtyWorktreeScreen,
  renderPostCheckScreen,
  renderProgress,
  renderRepoModeScreen,
  renderSummaryScreen,
  renderWelcomeScreen,
  waitForEnter
} from "./tui.js";
import { fetchTelegramBotIdentity, normalizeTelegramAllowedUserIds, pairTargetLabel } from "./telegram.js";
import type {
  BackgroundMode,
  InstallCommandOptions,
  InstallResult,
  InstallStatus,
  InstallStepRecord,
  PostInstallCheck,
  TelegramSetup
} from "./types.js";

function statusFromBootstrapReport(report: BootstrapReport): InstallStatus {
  return report.status;
}

function packageManagerLabel(value: string): string {
  switch (value) {
    case "apt-get":
      return "apt-get";
    case "dnf":
      return "dnf";
    case "winget":
      return "winget";
    case "choco":
      return "choco";
    case "brew":
      return "Homebrew";
    default:
      return "manual";
  }
}

function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

function nextSteps(repoPath: string, pairTarget: string, backgroundMode: BackgroundMode): string[] {
  const steps = [
    `cd ${repoPath}`,
    "pnpm dev",
    "pnpm daemon:pair",
    `Send \`/pair <CODE>\` to ${pairTarget}.`
  ];

  if (backgroundMode === "manual" || backgroundMode === "skip") {
    steps.push("Start the daemon manually with `pnpm dev:daemon` after pairing.");
  } else {
    steps.push("The host daemon background launcher is configured; log out/in or start it once manually if needed.");
  }

  return steps;
}

async function buildRepoEnv(repoPath: string, baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv
  };
  const envFilePath = path.join(repoPath, ".env");
  const envText = await readTextFileOrEmpty(envFilePath);
  if (envText) {
    Object.assign(env, parseDotEnv(envText));
  }

  return env;
}

function setPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, nextPath: string): void {
  if (platform === "win32") {
    env.Path = nextPath;
    if (env.PATH !== undefined) {
      env.PATH = nextPath;
    }
    return;
  }

  env.PATH = nextPath;
}

async function addNpmGlobalBinToPath(input: {
  env: NodeJS.ProcessEnv;
  cwd: string;
  platform: NodeJS.Platform;
}): Promise<void> {
  const npmPath = await resolveExecutable("npm", {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!npmPath) {
    return;
  }

  const prefixRun = await runCommand({
    command: npmPath,
    args: ["prefix", "-g"],
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);
  if (!prefixRun || prefixRun.exitCode !== 0) {
    return;
  }

  const prefix = prefixRun.stdout.trim().split(/\r?\n/u)[0]?.trim() ?? "";
  if (!prefix) {
    return;
  }

  const binDir = input.platform === "win32" ? prefix : path.join(prefix, "bin");
  const delimiter = input.platform === "win32" ? ";" : ":";
  const currentPath = input.platform === "win32"
    ? input.env.Path ?? input.env.PATH ?? ""
    : input.env.PATH ?? "";
  const entries = currentPath.split(delimiter).filter(Boolean);
  if (entries.includes(binDir)) {
    return;
  }

  setPath(input.env, input.platform, [binDir, ...entries].join(delimiter));
}

async function readExistingTelegramSetup(repoPath: string): Promise<TelegramSetup> {
  const envText = await readTextFileOrEmpty(path.join(repoPath, ".env"));
  const parsed = envText ? parseDotEnv(envText) : {};

  return {
    botToken: parsed.TELEGRAM_BOT_TOKEN ?? "",
    allowedUserIds: normalizeTelegramAllowedUserIds([parsed.TELEGRAM_ALLOWED_USER_IDS ?? ""]),
    homeChannel: parsed.TELEGRAM_HOME_CHANNEL ?? ""
  };
}

function backgroundOptionsForPlatform(platform: NodeJS.Platform): Array<{ mode: BackgroundMode; label: string; detail: string }> {
  if (platform === "darwin") {
    return [
      {
        mode: "launchagent",
        label: "LaunchAgent",
        detail: "Run the HappyTG host daemon in the user session at login."
      },
      {
        mode: "manual",
        label: "Manual",
        detail: "Keep daemon startup manual with `pnpm dev:daemon`."
      },
      {
        mode: "skip",
        label: "Skip",
        detail: "Do not configure any background run mode."
      }
    ];
  }

  if (platform === "win32") {
    return [
      {
        mode: "scheduled-task",
        label: "Scheduled Task",
        detail: "Create a logon task that starts the host daemon."
      },
      {
        mode: "startup",
        label: "Startup",
        detail: "Create a Startup entry that runs the host daemon on login."
      },
      {
        mode: "manual",
        label: "Manual",
        detail: "Keep daemon startup manual with `pnpm dev:daemon`."
      },
      {
        mode: "skip",
        label: "Skip",
        detail: "Do not configure any background run mode."
      }
    ];
  }

  return [
    {
      mode: "systemd-user",
      label: "systemd user service",
      detail: "Create a user service without changing the broader Linux service flow."
    },
    {
      mode: "manual",
      label: "Manual",
      detail: "Keep daemon startup manual with `pnpm dev:daemon`."
    },
    {
      mode: "skip",
      label: "Skip",
      detail: "Do not configure any background run mode."
    }
  ];
}

function createStep(id: string, label: string, detail: string): InstallStepRecord {
  return {
    id,
    label,
    status: "pending",
    detail
  };
}

async function writeInstallState(result: InstallResult, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<void> {
  const statePath = path.join(getLocalStateDir(env, platform), "state", "install-last.json");
  await writeJsonFileAtomic(statePath, {
    ...result,
    generatedAt: nowIso()
  });
}

function replaceStep(steps: InstallStepRecord[], next: InstallStepRecord): InstallStepRecord[] {
  return steps.map((step) => step.id === next.id ? next : step);
}

export async function runHappyTGInstall(
  options: InstallCommandOptions,
  input?: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    fetchImpl?: typeof fetch;
    runBootstrapCheck?: (command: PostInstallCheck, context?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      platform?: NodeJS.Platform;
    }) => Promise<BootstrapReport>;
  }
): Promise<InstallResult> {
  const stdin = input?.stdin ?? process.stdin;
  const stdout = input?.stdout ?? process.stdout;
  const runtimeRepoRoot = path.resolve(options.cwd);
  const platform = await detectInstallerEnvironment({
    cwd: runtimeRepoRoot,
    env: process.env,
    platform: process.platform,
    interactiveTerminal: !options.nonInteractive && !options.json && Boolean(stdin.isTTY && stdout.isTTY),
    repoRoot: runtimeRepoRoot
  });
  const interactive = platform.platform.isInteractiveTerminal && !options.nonInteractive && !options.json;
  const installEnv: NodeJS.ProcessEnv = {
    ...process.env
  };
  await addNpmGlobalBinToPath({
    env: installEnv,
    cwd: runtimeRepoRoot,
    platform: platform.platform.platform
  });

  if (interactive) {
    const welcome = renderWelcomeScreen({
      osLabel: `${platformLabel(platform.platform.platform)} ${platform.platform.arch}`,
      shell: platform.platform.shell,
      packageManager: packageManagerLabel(platform.platform.systemPackageManager),
      statuses: platform.dependencies.map((dependency) => ({
        status: dependency.available ? "pass" : dependency.required ? "warn" : "info",
        label: dependency.label,
        detail: dependency.available
          ? dependency.version ? `Ready (${dependency.version}).` : "Ready."
          : dependency.installCommand
            ? `${dependency.reason ?? "Missing."} Installer can run: ${dependency.installCommand}`
            : dependency.manualInstruction ?? dependency.reason ?? "Manual setup required."
      }))
    });
    await waitForEnter(stdin, stdout, welcome);
  }

  const repoChoices = await detectRepoModeChoices({
    launchCwd: options.launchCwd,
    repoDir: options.repoDir,
    bootstrapRepoRoot: options.bootstrapRepoRoot,
    env: installEnv,
    platform: platform.platform.platform
  });
  const repoMode = interactive
    ? await promptSelect({
      stdin,
      stdout,
      items: repoChoices.choices.filter((choice) => choice.available).map((choice) => choice.mode),
      initial: pickDefaultRepoMode(repoChoices.choices, options.repoMode),
      render: (activeMode) => renderRepoModeScreen({
        choices: repoChoices.choices.map((choice) => ({
          ...choice,
          available: choice.available
        })),
        activeMode
      })
    })
    : pickDefaultRepoMode(repoChoices.choices, options.repoMode);

  const selectedChoice = repoChoices.choices.find((choice) => choice.mode === repoMode);
  if (!selectedChoice || !selectedChoice.available) {
    throw new Error(`Repo mode ${repoMode} is not available in the current environment.`);
  }

  const relevantInspection = repoMode === "current" ? repoChoices.currentInspection : repoChoices.updateInspection;
  const dirtyStrategy = relevantInspection.dirty
    ? interactive
      ? await promptSelect({
        stdin,
        stdout,
        items: ["stash", "keep", "cancel"],
        initial: defaultDirtyWorktreeStrategy(true, options.dirtyWorktreeStrategy),
        render: (active) => renderDirtyWorktreeScreen({
          active: active as "stash" | "keep" | "cancel",
          repoPath: relevantInspection.rootPath ?? relevantInspection.path
        })
      })
      : defaultDirtyWorktreeStrategy(true, options.dirtyWorktreeStrategy)
    : "keep";

  const telegramDefaults = await readExistingTelegramSetup(selectedChoice.path).catch(() => ({
    botToken: "",
    allowedUserIds: [],
    homeChannel: ""
  }));
  const telegramSetup = interactive
    ? await promptTelegramForm({
      stdin,
      stdout,
      initial: {
        botToken: options.telegramBotToken ?? telegramDefaults.botToken,
        allowedUserIds: options.telegramAllowedUserIds.length > 0
          ? normalizeTelegramAllowedUserIds(options.telegramAllowedUserIds)
          : telegramDefaults.allowedUserIds,
        homeChannel: options.telegramHomeChannel ?? telegramDefaults.homeChannel
      }
    })
    : {
      botToken: options.telegramBotToken ?? telegramDefaults.botToken,
      allowedUserIds: options.telegramAllowedUserIds.length > 0
        ? normalizeTelegramAllowedUserIds(options.telegramAllowedUserIds)
        : telegramDefaults.allowedUserIds,
      homeChannel: options.telegramHomeChannel ?? telegramDefaults.homeChannel
    };

  const backgroundModes = backgroundOptionsForPlatform(platform.platform.platform);
  const backgroundMode = interactive
    ? await promptSelect({
      stdin,
      stdout,
      items: backgroundModes.map((mode) => mode.mode),
      initial: options.backgroundMode ?? backgroundModes[0]!.mode,
      render: (activeMode) => renderBackgroundModeScreen({
        platformLabel: platformLabel(platform.platform.platform),
        activeMode,
        modes: backgroundModes
      })
    })
    : options.backgroundMode ?? backgroundModes[0]!.mode;

  const postChecks = interactive
    ? await promptMultiSelect({
      stdin,
      stdout,
      items: ["setup", "doctor", "verify"],
      initial: options.postChecks,
      render: (activeIndex, selected) => renderPostCheckScreen({
        activeIndex,
        selected: selected as PostInstallCheck[]
      })
    })
    : options.postChecks;

  let steps: InstallStepRecord[] = [
    createStep("repo-sync", "Sync repository", `${repoMode} -> ${selectedChoice.path}`),
    ...platform.dependencies.map((dependency) => createStep(`dep-${dependency.id}`, dependency.label, dependency.available ? "Already available." : dependency.installCommand ?? dependency.manualInstruction ?? "Manual follow-up required.")),
    createStep("pnpm-install", "Install workspace dependencies", "Run `pnpm install` in the selected checkout."),
    createStep("env-merge", "Merge environment", "Create or merge `.env` without overwriting existing values."),
    createStep("telegram-bot", "Connect Telegram bot", "Validate the token and capture bot identity for later /pair guidance."),
    createStep("background", "Configure background run mode", backgroundModes.find((item) => item.mode === backgroundMode)?.detail ?? backgroundMode),
    ...postChecks.map((check) => createStep(`check-${check}`, `Run ${check}`, `Execute HappyTG ${check} in the selected checkout.`))
  ];

  if (interactive) {
    renderProgress(stdout, "Preparing to execute the one-command install flow.", steps);
  }

  const warnings: string[] = [];
  const updateStep = (next: InstallStepRecord) => {
    steps = replaceStep(steps, next);
    if (interactive) {
      renderProgress(stdout, "Preparing to execute the one-command install flow.", steps);
    }
  };

  updateStep({
    ...steps.find((step) => step.id === "repo-sync")!,
    status: "running",
    detail: `Running ${repoMode} mode for ${selectedChoice.path}.`
  });
  const repoSync = await syncRepository({
    selection: {
      mode: repoMode,
      path: selectedChoice.path,
      dirtyStrategy
    },
    repoUrl: options.repoUrl,
    branch: options.branch,
    currentInspection: repoChoices.currentInspection,
    updateInspection: repoChoices.updateInspection,
    env: installEnv,
    platform: platform.platform.platform
  });
  updateStep({
    ...steps.find((step) => step.id === "repo-sync")!,
    status: "passed",
    detail: `${repoSync.sync} ${repoSync.path}.`
  });

  const refreshedEnv = await detectInstallerEnvironment({
    cwd: runtimeRepoRoot,
    env: installEnv,
    platform: platform.platform.platform,
    interactiveTerminal: false,
    repoRoot: runtimeRepoRoot
  });
  await addNpmGlobalBinToPath({
    env: installEnv,
    cwd: repoSync.path,
    platform: platform.platform.platform
  });

  for (const dependency of refreshedEnv.dependencies) {
    const stepId = `dep-${dependency.id}`;
    if (dependency.available) {
      updateStep({
        ...steps.find((step) => step.id === stepId)!,
        status: "passed",
        detail: dependency.version ? `Available (${dependency.version}).` : "Available."
      });
      continue;
    }

    updateStep({
      ...steps.find((step) => step.id === stepId)!,
      status: "running",
      detail: dependency.installCommand ?? dependency.manualInstruction ?? "Manual follow-up required."
    });
    if (dependency.installCommand) {
      const installRun = await runShellCommand({
        commandLine: dependency.installCommand,
        cwd: repoSync.path,
        env: installEnv,
        platform: platform.platform.platform
      }).catch((error) => ({
        stdout: "",
        stderr: error instanceof Error ? error.message : "Install command failed.",
        exitCode: 1
      }));

      await addNpmGlobalBinToPath({
        env: installEnv,
        cwd: repoSync.path,
        platform: platform.platform.platform
      });
      if (installRun.exitCode === 0) {
        updateStep({
          ...steps.find((step) => step.id === stepId)!,
          status: "passed",
          detail: `Installed with \`${dependency.installCommand}\`.`
        });
      } else {
        warnings.push(`${dependency.label}: ${installRun.stderr.trim() || "install command failed"}`);
        updateStep({
          ...steps.find((step) => step.id === stepId)!,
          status: dependency.required ? "failed" : "warn",
          detail: installRun.stderr.trim() || installRun.stdout.trim() || "Install command failed."
        });
      }
      continue;
    }

    warnings.push(`${dependency.label}: ${dependency.manualInstruction ?? dependency.reason ?? "manual setup required"}`);
    updateStep({
      ...steps.find((step) => step.id === stepId)!,
      status: dependency.required ? "failed" : "warn",
      detail: dependency.manualInstruction ?? dependency.reason ?? "Manual setup required."
    });
  }

  const pnpmPath = await resolveExecutable("pnpm", {
    cwd: repoSync.path,
    env: installEnv,
    platform: platform.platform.platform
  });
  if (!pnpmPath) {
    throw new Error("pnpm is still not available after prerequisite resolution.");
  }

  updateStep({
    ...steps.find((step) => step.id === "pnpm-install")!,
    status: "running",
    detail: `Running \`${pnpmPath} install\` in ${repoSync.path}.`
  });
  const pnpmInstallRun = await runCommand({
    command: pnpmPath,
    args: ["install"],
    cwd: repoSync.path,
    env: installEnv,
    platform: platform.platform.platform
  });
  if (pnpmInstallRun.exitCode !== 0) {
    updateStep({
      ...steps.find((step) => step.id === "pnpm-install")!,
      status: "failed",
      detail: pnpmInstallRun.stderr.trim() || pnpmInstallRun.stdout.trim() || "pnpm install failed."
    });
    throw new Error(pnpmInstallRun.stderr.trim() || "pnpm install failed.");
  }
  updateStep({
    ...steps.find((step) => step.id === "pnpm-install")!,
    status: "passed",
    detail: "Workspace dependencies installed."
  });

  updateStep({
    ...steps.find((step) => step.id === "env-merge")!,
    status: "running",
    detail: "Writing Telegram-first onboarding values into `.env`."
  });
  const botIdentity = telegramSetup.botToken
    ? await fetchTelegramBotIdentity(telegramSetup.botToken, input?.fetchImpl)
    : {
      ok: false,
      error: "Bot token was not provided."
    };
  const envWrite = await writeMergedEnvFile({
    repoRoot: repoSync.path,
    env: installEnv,
    platform: platform.platform.platform,
    updates: {
      TELEGRAM_BOT_TOKEN: telegramSetup.botToken || undefined,
      TELEGRAM_ALLOWED_USER_IDS: telegramSetup.allowedUserIds.join(","),
      TELEGRAM_HOME_CHANNEL: telegramSetup.homeChannel || undefined,
      TELEGRAM_BOT_USERNAME: botIdentity.ok ? botIdentity.username : undefined
    }
  });
  updateStep({
    ...steps.find((step) => step.id === "env-merge")!,
    status: envWrite.changed || envWrite.created ? "passed" : "skipped",
    detail: envWrite.created
      ? `Created ${envWrite.envFilePath}.`
      : envWrite.changed
        ? envWrite.backupPath
          ? `Merged ${envWrite.envFilePath} and backed up the previous file.`
          : `Merged ${envWrite.envFilePath}.`
        : "Environment was already up to date."
  });

  updateStep({
    ...steps.find((step) => step.id === "telegram-bot")!,
    status: "running",
    detail: "Validating Telegram bot token and identity."
  });
  if (telegramSetup.botToken && botIdentity.ok) {
    updateStep({
      ...steps.find((step) => step.id === "telegram-bot")!,
      status: "passed",
      detail: botIdentity.username
        ? `Connected to @${botIdentity.username}.`
        : "Bot token validated."
    });
  } else if (telegramSetup.botToken && !botIdentity.ok) {
    warnings.push(`Telegram bot lookup: ${botIdentity.error ?? "validation failed"}`);
    updateStep({
      ...steps.find((step) => step.id === "telegram-bot")!,
      status: "warn",
      detail: botIdentity.error ?? "Unable to confirm the bot identity right now."
    });
  } else {
    warnings.push("Telegram bot token is still missing; later setup/doctor will keep warning until it is added.");
    updateStep({
      ...steps.find((step) => step.id === "telegram-bot")!,
      status: "warn",
      detail: "No Telegram bot token was provided."
    });
  }

  updateStep({
    ...steps.find((step) => step.id === "background")!,
    status: "running",
    detail: `Configuring ${backgroundMode}.`
  });
  const background = await configureBackgroundMode({
    mode: backgroundMode,
    repoRoot: repoSync.path,
    env: installEnv,
    platform: platform.platform.platform
  });
  updateStep({
    ...steps.find((step) => step.id === "background")!,
    status: background.status === "configured" ? "passed" : background.status === "failed" ? "failed" : background.status === "manual" ? "warn" : "skipped",
    detail: background.detail
  });

  const repoEnv = await buildRepoEnv(repoSync.path, installEnv);
  const postCheckReports: InstallResult["postChecks"] = [];
  for (const check of postChecks) {
    const stepId = `check-${check}`;
    updateStep({
      ...steps.find((step) => step.id === stepId)!,
      status: "running",
      detail: `Running HappyTG ${check}.`
    });
    if (!input?.runBootstrapCheck) {
      updateStep({
        ...steps.find((step) => step.id === stepId)!,
        status: "skipped",
        detail: "Bootstrap check runner is not available in this execution path."
      });
      continue;
    }

    const report = await input.runBootstrapCheck(check, {
      cwd: repoSync.path,
      env: repoEnv,
      platform: platform.platform.platform
    });
    postCheckReports.push({
      command: check,
      status: statusFromBootstrapReport(report),
      summary: report.findings.length > 0
        ? report.findings.map((finding) => finding.message).join(" ")
        : "Environment looks ready."
    });
    updateStep({
      ...steps.find((step) => step.id === stepId)!,
      status: report.status === "pass" ? "passed" : report.status === "warn" ? "warn" : "failed",
      detail: report.findings.length > 0 ? report.findings[0]!.message : "Environment looks ready."
    });
  }

  const finalEnvironment = await detectInstallerEnvironment({
    cwd: runtimeRepoRoot,
    env: installEnv,
    platform: platform.platform.platform,
    interactiveTerminal: false,
    repoRoot: runtimeRepoRoot
  });
  const missingRequiredStep = steps.some((step) => step.status === "failed" && step.id.startsWith("dep-"));
  const overallStatus: InstallStatus = missingRequiredStep || steps.some((step) => step.status === "failed")
    ? "fail"
    : warnings.length > 0 || steps.some((step) => step.status === "warn")
      ? "warn"
      : "pass";
  const pairTarget = pairTargetLabel(botIdentity.ok ? botIdentity : undefined);
  const result: InstallResult = {
    kind: "install",
    status: overallStatus,
    interactive,
    repo: {
      mode: repoMode,
      path: repoSync.path,
      sync: repoSync.sync,
      dirtyStrategy
    },
    environment: finalEnvironment,
    telegram: {
      configured: Boolean(telegramSetup.botToken),
      allowedUserIds: telegramSetup.allowedUserIds,
      homeChannel: telegramSetup.homeChannel || undefined,
      bot: botIdentity
    },
    background,
    postChecks: postCheckReports,
    steps,
    nextSteps: nextSteps(repoSync.path, pairTarget, backgroundMode),
    warnings,
    reportJson: {
      repoUrl: options.repoUrl,
      branch: options.branch,
      envWrite,
      botIdentity,
      pairTarget,
      packageManager: platform.platform.systemPackageManager,
      platform: platform.platform
    }
  };
  await writeInstallState(result, installEnv, platform.platform.platform);

  if (interactive) {
    await waitForEnter(stdin, stdout, renderSummaryScreen({
      repoPath: repoSync.path,
      warnings,
      nextSteps: result.nextSteps,
      backgroundDetail: background.detail
    }));
  }

  return result;
}
