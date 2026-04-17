import path from "node:path";

import type { BootstrapReport } from "../../../protocol/src/index.js";
import {
  findUpwardFile,
  getLocalStateDir,
  normalizeSpawnEnv,
  nowIso,
  parseDotEnv,
  readTextFileOrEmpty,
  resolveExecutable,
  writeJsonFileAtomic
} from "../../../shared/src/index.js";

import { configureBackgroundMode } from "./background.js";
import { runCommand, runShellCommand, CommandExecutionError } from "./commands.js";
import { resolveInstallerRepoSources } from "./config.js";
import { writeMergedEnvFile } from "./env.js";
import { createInstallRuntimeError, isRetryableCommandOutput, toInstallRuntimeErrorDetail } from "./errors.js";
import { detectInstallerEnvironment } from "./platform.js";
import {
  defaultDirtyWorktreeStrategy,
  detectRepoModeChoices,
  pickDefaultRepoMode,
  syncRepository
} from "./repo.js";
import { createPartialFailureDetail, deriveInstallOutcome, installStatusFromOutcome } from "./status.js";
import { readInstallDraft, writeInstallDraft } from "./state.js";
import {
  promptMultiSelect,
  promptSelect,
  promptTelegramForm,
  renderBackgroundModeScreen,
  renderFinalScreen,
  renderDirtyWorktreeScreen,
  renderPostCheckScreen,
  renderProgress,
  renderRepoModeScreen,
  renderSummaryScreen,
  renderWelcomeScreen,
  waitForEnter
} from "./tui.js";
import { fetchTelegramBotIdentity, normalizeTelegramAllowedUserIds, pairTargetLabel, telegramLookupDiagnostic, validateTelegramBotToken } from "./telegram.js";
import type {
  BackgroundMode,
  InstallCommandOptions,
  InstallDraftState,
  InstallRepoMode,
  InstallResult,
  InstallRuntimeErrorDetail,
  InstallStatus,
  InstallStepRecord,
  PostInstallCheck,
  RepoSyncProgressEvent,
  RepoSyncResult,
  TelegramSetup
} from "./types.js";

const DEFAULT_POST_CHECKS: PostInstallCheck[] = ["setup", "doctor", "verify"];

interface InstallRuntimeDependencies {
  configureBackgroundMode: typeof configureBackgroundMode;
  detectInstallerEnvironment: typeof detectInstallerEnvironment;
  detectRepoModeChoices: typeof detectRepoModeChoices;
  fetchTelegramBotIdentity: typeof fetchTelegramBotIdentity;
  readInstallDraft: typeof readInstallDraft;
  resolveExecutable: typeof resolveExecutable;
  runCommand: typeof runCommand;
  runShellCommand: typeof runShellCommand;
  syncRepository: typeof syncRepository;
  writeInstallDraft: typeof writeInstallDraft;
  writeMergedEnvFile: typeof writeMergedEnvFile;
}

function statusFromBootstrapReport(report: BootstrapReport): InstallStatus {
  return report.status;
}

function pushUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized || lines.includes(normalized)) {
    return;
  }
  lines.push(normalized);
}

function pushUniqueLines(lines: string[], next: readonly string[]): void {
  for (const line of next) {
    pushUniqueLine(lines, line);
  }
}

function nextStepSemanticKey(line: string): string {
  const normalized = line.trim().toLowerCase().replace(/\s+/gu, " ");

  if (normalized === "pnpm dev" || normalized.includes("start repo services: `pnpm dev`")) {
    return "start-repo-services";
  }
  if (normalized === "pnpm daemon:pair" || normalized.includes("pairing code on the execution host: `pnpm daemon:pair`")) {
    return "request-pair-code";
  }
  if (normalized.includes("send `/pair <code>`")) {
    return "complete-pairing";
  }

  return normalized;
}

function pushUniqueNextStep(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) {
    return;
  }

  const key = nextStepSemanticKey(normalized);
  if (lines.some((existing) => nextStepSemanticKey(existing) === key)) {
    return;
  }

  lines.push(normalized);
}

function pushUniqueNextSteps(lines: string[], next: readonly string[]): void {
  for (const line of next) {
    pushUniqueNextStep(lines, line);
  }
}

function bootstrapReportSummary(report: BootstrapReport): string {
  return report.findings.length > 0
    ? report.findings.map((finding) => finding.message).join(" ")
    : "Environment looks ready.";
}

function bootstrapReportSignature(report: BootstrapReport): string | undefined {
  if (report.findings.length === 0) {
    return undefined;
  }

  return report.findings
    .map((finding) => `${finding.severity}:${finding.code}:${finding.message}`)
    .sort()
    .join("\n");
}

function warningMessagesFromBootstrapReport(report: BootstrapReport): string[] {
  if (report.status !== "warn") {
    return [];
  }
  return report.findings
    .filter((finding) => finding.severity === "warn")
    .map((finding) => finding.message);
}

function nextStepsFromBootstrapReport(report: BootstrapReport): string[] {
  return report.status === "warn" ? report.planPreview : [];
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
    "pnpm daemon:pair"
  ];

  if (backgroundMode === "manual" || backgroundMode === "skip") {
    steps.push(`Send \`/pair <CODE>\` to ${pairTarget}, then start the daemon with \`pnpm dev:daemon\`.`);
  } else {
    steps.push(`Send \`/pair <CODE>\` to ${pairTarget}.`);
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
  runCommandImpl: typeof runCommand;
  resolveExecutableImpl: typeof resolveExecutable;
}): Promise<void> {
  const npmPath = await input.resolveExecutableImpl("npm", {
    cwd: input.cwd,
    env: input.env,
    platform: input.platform
  });
  if (!npmPath) {
    return;
  }

  const prefixRun = await input.runCommandImpl({
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
    ? normalizeSpawnEnv(input.env, input.platform).Path ?? ""
    : input.env.PATH ?? "";
  const entries = currentPath.split(delimiter).filter(Boolean);
  if (entries.includes(binDir)) {
    return;
  }

  setPath(input.env, input.platform, [binDir, ...entries].join(delimiter));
}

async function readExistingTelegramSetup(repoPath: string): Promise<TelegramSetup & { botUsername?: string }> {
  const envText = await readTextFileOrEmpty(path.join(repoPath, ".env"));
  const parsed = envText ? parseDotEnv(envText) : {};

  return {
    botToken: parsed.TELEGRAM_BOT_TOKEN ?? "",
    allowedUserIds: normalizeTelegramAllowedUserIds([parsed.TELEGRAM_ALLOWED_USER_IDS ?? ""]),
    homeChannel: parsed.TELEGRAM_HOME_CHANNEL ?? "",
    botUsername: parsed.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "") || undefined
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
      mode: "manual",
      label: "Manual",
      detail: "Keep daemon startup manual with `pnpm dev:daemon`."
    },
    {
      mode: "systemd-user",
      label: "systemd user service",
      detail: "Create a user service without changing the broader Linux service flow."
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

function samePostChecks(left: PostInstallCheck[], right: PostInstallCheck[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function repoSyncDetail(event: RepoSyncProgressEvent): string {
  if (event.phase === "attempt") {
    return `${event.source.label}: attempt ${event.attempt}/${event.maxAttempts}\n${event.source.url}`;
  }

  if (event.phase === "retry") {
    const backoffSeconds = ((event.backoffMs ?? 0) / 1000).toFixed(1);
    return `${event.source.label}: attempt ${event.attempt}/${event.maxAttempts} failed.\n${event.errorMessage ?? "Remote access failed."}\nRetrying in ${backoffSeconds}s.`;
  }

  return `${event.detail}\n${event.errorMessage ?? ""}`.trim();
}

function commandFailureDetail(error: CommandExecutionError, fallback?: Partial<InstallRuntimeErrorDetail>): InstallRuntimeErrorDetail {
  return toInstallRuntimeErrorDetail(error, {
    code: error.detail.likelyWindowsShim ? "windows_shim_failure" : "command_spawn_failure",
    message: fallback?.message ?? error.message,
    lastError: error.message,
    retryable: false,
    suggestedAction: error.detail.likelyWindowsShim
      ? `Open a new shell, verify \`${error.detail.failedBinary} --version\`, or reinstall the tool to repair the Windows shim before rerunning the installer.`
      : `Verify that ${error.detail.failedBinary} is installed and runnable in this shell, then rerun the installer.`,
    failedCommand: error.detail.failedCommand,
    failedBinary: error.detail.failedBinary,
    binaryPath: error.detail.binaryPath,
    ...fallback
  });
}

async function runPnpmInstall(input: {
  repoPath: string;
  pnpmPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  updateStep: (next: InstallStepRecord) => void;
  step: InstallStepRecord;
  runCommandImpl: typeof runCommand;
}): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.updateStep({
      ...input.step,
      status: "running",
      detail: `Running \`${input.pnpmPath} install\` in ${input.repoPath}.\nAttempt ${attempt}/${maxAttempts}.`
    });

    let result;
    try {
      result = await input.runCommandImpl({
        command: input.pnpmPath,
        args: ["install"],
        cwd: input.repoPath,
        env: input.env,
        platform: input.platform
      });
    } catch (error) {
      if (error instanceof CommandExecutionError) {
        throw createInstallRuntimeError(commandFailureDetail(error, {
          code: error.detail.likelyWindowsShim ? "windows_shim_failure" : "command_spawn_failure",
          message: `pnpm failed to start from ${error.detail.binaryPath}.`,
          failedCommand: "pnpm install",
          failedBinary: "pnpm",
          binaryPath: error.detail.binaryPath
        }));
      }

      throw error;
    }

    if (result.exitCode === 0) {
      return result;
    }

    const lastError = result.stderr.trim() || result.stdout.trim() || "pnpm install failed.";
    const retryable = isRetryableCommandOutput(lastError);
    if (retryable && attempt < maxAttempts) {
      input.updateStep({
        ...input.step,
        status: "running",
        detail: `pnpm install attempt ${attempt}/${maxAttempts} failed.\n${lastError}\nRetrying once because the failure looks transient.`
      });
      continue;
    }

    throw createInstallRuntimeError({
      code: "pnpm_install_failed",
      message: "pnpm install failed.",
      lastError,
      retryable,
      suggestedAction: retryable
        ? "Retry the installer after network connectivity stabilizes."
        : "Fix the pnpm install failure in the selected checkout, then rerun the installer.",
      failedCommand: "pnpm install",
      failedBinary: "pnpm",
      binaryPath: result.binaryPath
    });
  }

  throw createInstallRuntimeError({
    code: "pnpm_install_failed",
    message: "pnpm install failed.",
    lastError: "pnpm install failed.",
    retryable: false,
    suggestedAction: "Fix the pnpm install failure in the selected checkout, then rerun the installer.",
    failedCommand: "pnpm install",
    failedBinary: "pnpm",
    binaryPath: input.pnpmPath
  });
}

function createFallbackBackground(mode: BackgroundMode): InstallResult["background"] {
  return {
    mode,
    status: mode === "skip" ? "skipped" : mode === "manual" ? "manual" : "failed",
    detail: "Installer stopped before background configuration completed."
  };
}

function fallbackInstallRepoMode(options: InstallCommandOptions): InstallRepoMode {
  return options.repoMode ?? "clone";
}

function fallbackInstallBackgroundMode(options: InstallCommandOptions): BackgroundMode {
  return options.backgroundMode ?? "manual";
}

function installDetailFromBackground(detail: string): string {
  return detail || "Installer finished without additional background details.";
}

function nonInteractiveTokenValidationErrorMessage(validationMessage: string): string {
  return validationMessage.endsWith(".")
    ? validationMessage
    : `${validationMessage}.`;
}

export function createInstallFailureResult(input: {
  options: InstallCommandOptions;
  error: unknown;
}): InstallResult {
  const detail = toInstallRuntimeErrorDetail(input.error, {
    code: "installer_runtime_failure",
    message: input.error instanceof Error ? input.error.message : "HappyTG install failed.",
    lastError: input.error instanceof Error ? input.error.message : "HappyTG install failed.",
    retryable: false,
    suggestedAction: "Review the installer output and rerun once the reported issue is fixed."
  });
  const backgroundMode = fallbackInstallBackgroundMode(input.options);
  const outcome = deriveInstallOutcome({
    warnings: [],
    steps: [],
    error: detail
  });

  return {
    kind: "install",
    status: installStatusFromOutcome(outcome),
    outcome,
    interactive: !input.options.nonInteractive && !input.options.json,
    tuiHandled: false,
    repo: {
      mode: fallbackInstallRepoMode(input.options),
      path: input.options.repoDir ?? input.options.launchCwd,
      sync: "reused",
      dirtyStrategy: input.options.dirtyWorktreeStrategy ?? "keep",
      source: detail.repoSource ?? "local",
      repoUrl: detail.repoUrl ?? input.options.repoUrl ?? "unresolved",
      attempts: detail.attempts ?? 0,
      fallbackUsed: detail.fallbackUsed ?? false
    },
    environment: {
      platform: {
        platform: process.platform,
        arch: process.arch,
        shell: process.env.SHELL ?? process.env.ComSpec ?? "",
        linuxFamily: "unknown",
        systemPackageManager: "manual",
        repoPackageManager: "pnpm",
        isInteractiveTerminal: false
      },
      dependencies: []
    },
    telegram: {
      configured: Boolean(input.options.telegramBotToken),
      allowedUserIds: input.options.telegramAllowedUserIds,
      homeChannel: input.options.telegramHomeChannel
    },
    background: createFallbackBackground(backgroundMode),
    postChecks: [],
    steps: [],
    nextSteps: [],
    warnings: [],
    error: detail,
    reportJson: {
      branch: input.options.branch,
      error: detail,
      outcome,
      repoUrl: detail.repoUrl ?? input.options.repoUrl ?? "unresolved"
    }
  };
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
    deps?: Partial<InstallRuntimeDependencies>;
  }
): Promise<InstallResult> {
  const deps: InstallRuntimeDependencies = {
    configureBackgroundMode,
    detectInstallerEnvironment,
    detectRepoModeChoices,
    fetchTelegramBotIdentity,
    readInstallDraft,
    resolveExecutable,
    runCommand,
    runShellCommand,
    syncRepository,
    writeInstallDraft,
    writeMergedEnvFile,
    ...input?.deps
  };
  const stdin = input?.stdin ?? process.stdin;
  const stdout = input?.stdout ?? process.stdout;
  const cwd = path.resolve(options.cwd);
  const workspaceRootMarker = options.bootstrapRepoRoot
    ? undefined
    : findUpwardFile(cwd, "pnpm-workspace.yaml");
  const installerRepoRoot = path.resolve(options.bootstrapRepoRoot ?? (workspaceRootMarker ? path.dirname(workspaceRootMarker) : cwd));
  const platform = await deps.detectInstallerEnvironment({
    cwd,
    env: process.env,
    platform: process.platform,
    interactiveTerminal: !options.nonInteractive && !options.json && Boolean(stdin.isTTY && stdout.isTTY),
    repoRoot: installerRepoRoot
  });
  const interactive = platform.platform.isInteractiveTerminal && !options.nonInteractive && !options.json;
  const installEnv: NodeJS.ProcessEnv = {
    ...process.env
  };
  let draft = await deps.readInstallDraft({
    env: installEnv,
    platform: platform.platform.platform
  });
  await addNpmGlobalBinToPath({
    env: installEnv,
    cwd,
    platform: platform.platform.platform,
    runCommandImpl: deps.runCommand,
    resolveExecutableImpl: deps.resolveExecutable
  });

  const saveDraft = async (patch: {
    repo?: InstallDraftState["repo"];
    telegram?: TelegramSetup;
    backgroundMode?: BackgroundMode;
    postChecks?: PostInstallCheck[];
  }): Promise<void> => {
    draft = await deps.writeInstallDraft({
      draft: {
        version: 1,
        repo: {
          ...(draft?.repo ?? {}),
          ...(patch.repo ?? {})
        },
        telegram: patch.telegram
          ? {
            botToken: patch.telegram.botToken,
            allowedUserIds: [...patch.telegram.allowedUserIds],
            homeChannel: patch.telegram.homeChannel
          }
          : draft?.telegram,
        backgroundMode: patch.backgroundMode ?? draft?.backgroundMode,
        postChecks: patch.postChecks ?? draft?.postChecks,
        updatedAt: nowIso()
      },
      env: installEnv,
      platform: platform.platform.platform
    });
  };

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

  const repoSources = resolveInstallerRepoSources({
    repoRoot: installerRepoRoot,
    requestedRepoUrl: options.repoUrl
  });
  const repoChoices = await deps.detectRepoModeChoices({
    launchCwd: options.launchCwd,
    repoDir: options.repoDir ?? draft?.repo?.dir,
    bootstrapRepoRoot: options.bootstrapRepoRoot,
    env: installEnv,
    platform: platform.platform.platform
  });
  const draftRepoMode = draft?.repo?.mode;
  const savedRepoMode = draftRepoMode && repoChoices.choices.some((choice) => choice.mode === draftRepoMode && choice.available)
    ? draftRepoMode
    : undefined;
  let repoMode = interactive
    ? await promptSelect({
      stdin,
      stdout,
      items: repoChoices.choices.filter((choice) => choice.available).map((choice) => choice.mode),
      initial: pickDefaultRepoMode(repoChoices.choices, options.repoMode ?? savedRepoMode),
      render: (activeMode) => renderRepoModeScreen({
        choices: repoChoices.choices.map((choice) => ({
          ...choice,
          available: choice.available
        })),
        activeMode
      })
    })
    : pickDefaultRepoMode(repoChoices.choices, options.repoMode ?? savedRepoMode);
  let selectedChoice = repoChoices.choices.find((choice) => choice.mode === repoMode);
  let relevantInspection = repoMode === "current" ? repoChoices.currentInspection : repoChoices.updateInspection;
  let dirtyStrategy = defaultDirtyWorktreeStrategy(relevantInspection.dirty, options.dirtyWorktreeStrategy ?? draft?.repo?.dirtyStrategy);

  const repoTelegramDefaults = await readExistingTelegramSetup(selectedChoice?.path ?? repoChoices.clonePath).catch(() => ({
    botToken: "",
    allowedUserIds: [],
    homeChannel: "",
    botUsername: undefined
  }));
  const knownBotUsername = repoTelegramDefaults.botUsername ?? "";
  const telegramInitial: TelegramSetup = {
    botToken: interactive
      ? options.telegramBotToken ?? ""
      : options.telegramBotToken ?? draft?.telegram?.botToken ?? repoTelegramDefaults.botToken,
    allowedUserIds: options.telegramAllowedUserIds.length > 0
      ? normalizeTelegramAllowedUserIds(options.telegramAllowedUserIds)
      : draft?.telegram?.allowedUserIds ?? repoTelegramDefaults.allowedUserIds,
    homeChannel: options.telegramHomeChannel ?? draft?.telegram?.homeChannel ?? repoTelegramDefaults.homeChannel
  };
  let telegramSetup = telegramInitial;
  const backgroundModes = backgroundOptionsForPlatform(platform.platform.platform);
  const backgroundDefault = options.backgroundMode ?? draft?.backgroundMode ?? backgroundModes[0]!.mode;
  let backgroundMode = backgroundDefault;
  const requestedPostChecks = samePostChecks(options.postChecks, DEFAULT_POST_CHECKS) && draft?.postChecks
    ? draft.postChecks
    : options.postChecks;
  let postChecks = requestedPostChecks;

  let steps: InstallStepRecord[] = [];
  const warnings: string[] = [];
  let activeStepId: string | undefined;
  let repoSyncResult: RepoSyncResult | undefined;
  let botIdentity: InstallResult["telegram"]["bot"] | undefined;
  let telegramLookup: InstallResult["telegram"]["lookup"] | undefined;
  let background = createFallbackBackground(backgroundMode);

  const updateStep = (next: InstallStepRecord) => {
    steps = replaceStep(steps, next);
    activeStepId = next.status === "running" ? next.id : activeStepId === next.id ? undefined : activeStepId;
    if (interactive) {
      renderProgress(stdout, "Preparing to execute the one-command install flow.", steps);
    }
  };

  const finalizeFailure = async (error: unknown): Promise<InstallResult> => {
    const detail = toInstallRuntimeErrorDetail(error, {
      code: "installer_runtime_failure",
      message: error instanceof Error ? error.message : "HappyTG install failed.",
      lastError: error instanceof Error ? error.message : "HappyTG install failed.",
      retryable: false,
      suggestedAction: "Review the installer output and rerun once the reported issue is fixed."
    });
    if (activeStepId) {
      const activeStep = steps.find((step) => step.id === activeStepId);
      if (activeStep && activeStep.status === "running") {
        updateStep({
          ...activeStep,
          status: "failed",
          detail: detail.lastError
        });
      }
    }
    const outcome = deriveInstallOutcome({
      warnings,
      steps,
      error: detail
    });

    const failureResult: InstallResult = {
      kind: "install",
      status: installStatusFromOutcome(outcome),
      outcome,
      interactive,
      tuiHandled: interactive,
      repo: {
        mode: repoMode,
        path: repoSyncResult?.path ?? selectedChoice?.path ?? repoChoices.clonePath,
        sync: repoSyncResult?.sync ?? "reused",
        dirtyStrategy,
        source: repoSyncResult?.repoSource ?? detail.repoSource ?? draft?.repo?.source ?? "local",
        repoUrl: repoSyncResult?.repoUrl ?? detail.repoUrl ?? repoSources.primary.url,
        attempts: repoSyncResult?.attempts ?? detail.attempts ?? 0,
        fallbackUsed: repoSyncResult?.fallbackUsed ?? detail.fallbackUsed ?? false
      },
      environment: platform,
      telegram: {
        configured: Boolean(telegramSetup.botToken),
        allowedUserIds: telegramSetup.allowedUserIds,
        homeChannel: telegramSetup.homeChannel || undefined,
        bot: botIdentity,
        lookup: telegramLookup ?? telegramLookupDiagnostic({
          botToken: telegramSetup.botToken,
          identity: botIdentity,
          knownUsername: knownBotUsername
        })
      },
      background,
      postChecks: [],
      steps,
      nextSteps: [],
      warnings,
      error: detail,
      reportJson: {
        branch: options.branch,
        error: detail,
        fallbackSource: repoSources.fallback?.url,
        fallbackUsed: repoSyncResult?.fallbackUsed ?? detail.fallbackUsed ?? false,
        outcome,
        platform: platform.platform,
        repoSource: repoSyncResult?.repoSource ?? detail.repoSource ?? draft?.repo?.source ?? "local",
        repoUrl: repoSyncResult?.repoUrl ?? detail.repoUrl ?? repoSources.primary.url
      }
    };
    await writeInstallState(failureResult, installEnv, platform.platform.platform);

    if (interactive) {
      await waitForEnter(stdin, stdout, renderFinalScreen({
        outcome,
        repoPath: failureResult.repo.path,
        detail: detail.lastError,
        warnings: failureResult.warnings,
        nextSteps: failureResult.nextSteps,
        suggestedAction: detail.suggestedAction
      }));
    }

    return failureResult;
  };

  try {
    selectedChoice = repoChoices.choices.find((choice) => choice.mode === repoMode);
    if (!selectedChoice || !selectedChoice.available) {
      throw createInstallRuntimeError({
        code: "installer_runtime_failure",
        message: `Repo mode ${repoMode} is not available in the current environment.`,
        lastError: `Repo mode ${repoMode} is not available in the current environment.`,
        retryable: false,
        suggestedAction: "Choose one of the available repository modes or point --repo-dir at a compatible checkout."
      });
    }
    relevantInspection = repoMode === "current" ? repoChoices.currentInspection : repoChoices.updateInspection;
    dirtyStrategy = relevantInspection.dirty
      ? interactive
        ? await promptSelect({
          stdin,
          stdout,
          items: ["stash", "keep", "cancel"],
          initial: defaultDirtyWorktreeStrategy(true, options.dirtyWorktreeStrategy ?? draft?.repo?.dirtyStrategy),
          render: (active) => renderDirtyWorktreeScreen({
            active: active as "stash" | "keep" | "cancel",
            repoPath: relevantInspection.rootPath ?? relevantInspection.path
          })
        })
        : defaultDirtyWorktreeStrategy(true, options.dirtyWorktreeStrategy ?? draft?.repo?.dirtyStrategy)
      : "keep";
    telegramSetup = interactive
      ? await promptTelegramForm({
        stdin,
        stdout,
        initial: telegramInitial
      })
      : telegramInitial;
    if (!interactive) {
      const tokenValidationMessage = validateTelegramBotToken(telegramSetup.botToken);
      if (tokenValidationMessage) {
        const message = nonInteractiveTokenValidationErrorMessage(tokenValidationMessage);
        throw createInstallRuntimeError({
          code: "installer_validation_failure",
          message,
          lastError: message,
          retryable: false,
          suggestedAction: "Pass a valid --telegram-bot-token or rerun the installer interactively so the value can be captured and validated before execution."
        });
      }
    }
    backgroundMode = interactive
      ? await promptSelect({
        stdin,
        stdout,
        items: backgroundModes.map((mode) => mode.mode),
        initial: backgroundDefault,
        render: (activeMode) => renderBackgroundModeScreen({
          platformLabel: platformLabel(platform.platform.platform),
          activeMode,
          modes: backgroundModes
        })
      })
      : backgroundDefault;
    background = createFallbackBackground(backgroundMode);
    postChecks = interactive
      ? await promptMultiSelect({
        stdin,
        stdout,
        items: DEFAULT_POST_CHECKS,
        initial: requestedPostChecks,
        render: (activeIndex, selected) => renderPostCheckScreen({
          activeIndex,
          selected: selected as PostInstallCheck[]
        })
      })
      : requestedPostChecks;
    await saveDraft({
      repo: {
        mode: repoMode,
        dir: selectedChoice.path,
        source: draft?.repo?.source,
        url: repoSources.primary.url,
        branch: options.branch,
        dirtyStrategy
      },
      telegram: telegramSetup,
      backgroundMode,
      postChecks
    });
    steps = [
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
    updateStep({
      ...steps.find((step) => step.id === "repo-sync")!,
      status: "running",
      detail: `Running ${repoMode} mode for ${selectedChoice.path}.`
    });
    repoSyncResult = await deps.syncRepository({
      selection: {
        mode: repoMode,
        path: selectedChoice.path,
        dirtyStrategy
      },
      sources: repoSources.sources,
      branch: options.branch,
      currentInspection: repoChoices.currentInspection,
      updateInspection: repoChoices.updateInspection,
      env: installEnv,
      platform: platform.platform.platform,
      onProgress: (event) => {
        updateStep({
          ...steps.find((step) => step.id === "repo-sync")!,
          status: "running",
          detail: repoSyncDetail(event)
        });
      }
    });
    updateStep({
      ...steps.find((step) => step.id === "repo-sync")!,
      status: "passed",
      detail: `${repoSyncResult.sync} ${repoSyncResult.path} via ${repoSyncResult.repoSource === "fallback" ? "fallback source" : repoSyncResult.repoSource === "primary" ? "primary source" : "local checkout"}.`
    });
    if (repoSyncResult.fallbackUsed) {
      warnings.push(`Repository sync used the configured fallback source: ${repoSyncResult.repoUrl}`);
    }
    await saveDraft({
      repo: {
        mode: repoMode,
        dir: selectedChoice.path,
        path: repoSyncResult.path,
        source: repoSyncResult.repoSource,
        url: repoSyncResult.repoUrl,
        branch: options.branch,
        dirtyStrategy
      }
    });

    const refreshedEnv = await deps.detectInstallerEnvironment({
      cwd,
      env: installEnv,
      platform: platform.platform.platform,
      interactiveTerminal: false,
      repoRoot: installerRepoRoot
    });
    await addNpmGlobalBinToPath({
      env: installEnv,
      cwd: repoSyncResult.path,
      platform: platform.platform.platform,
      runCommandImpl: deps.runCommand,
      resolveExecutableImpl: deps.resolveExecutable
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
        const installRun = await deps.runShellCommand({
          commandLine: dependency.installCommand,
          cwd: repoSyncResult.path,
          env: installEnv,
          platform: platform.platform.platform
        }).catch((error) => ({
          stdout: "",
          stderr: error instanceof Error ? error.message : "Install command failed.",
          exitCode: 1,
          binaryPath: "",
          shell: false,
          fallbackUsed: false
        }));

        await addNpmGlobalBinToPath({
          env: installEnv,
          cwd: repoSyncResult.path,
          platform: platform.platform.platform,
          runCommandImpl: deps.runCommand,
          resolveExecutableImpl: deps.resolveExecutable
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

    const pnpmPath = await deps.resolveExecutable("pnpm", {
      cwd: repoSyncResult.path,
      env: installEnv,
      platform: platform.platform.platform
    });
    if (!pnpmPath) {
      throw createInstallRuntimeError({
        code: "command_execution_failure",
        message: "pnpm is still not available after prerequisite resolution.",
        lastError: "pnpm is still not available after prerequisite resolution.",
        retryable: false,
        suggestedAction: "Install or repair pnpm in the current shell, verify `pnpm --version`, then rerun the installer.",
        failedBinary: "pnpm"
      });
    }

    const pnpmInstallStep = steps.find((step) => step.id === "pnpm-install")!;
    const pnpmInstallRun = await runPnpmInstall({
      repoPath: repoSyncResult.path,
      pnpmPath,
      env: installEnv,
      platform: platform.platform.platform,
      updateStep,
      step: pnpmInstallStep,
      runCommandImpl: deps.runCommand
    });
    updateStep({
      ...pnpmInstallStep,
      status: "passed",
      detail: pnpmInstallRun.fallbackUsed
        ? "Workspace dependencies installed after recovering from a Windows shim launch issue."
        : "Workspace dependencies installed."
    });

    updateStep({
      ...steps.find((step) => step.id === "env-merge")!,
      status: "running",
      detail: "Writing Telegram-first onboarding values into `.env`."
    });
    botIdentity = telegramSetup.botToken
      ? await deps.fetchTelegramBotIdentity(telegramSetup.botToken, input?.fetchImpl)
      : {
        ok: false,
        error: "Bot token was not provided.",
        step: "getMe",
        failureKind: "missing_token",
        recoverable: false
      };
    if (!botIdentity.ok && !botIdentity.username && knownBotUsername) {
      botIdentity = {
        ...botIdentity,
        username: knownBotUsername
      };
    }
    telegramLookup = telegramLookupDiagnostic({
      botToken: telegramSetup.botToken,
      identity: botIdentity,
      knownUsername: knownBotUsername
    });
    const envWrite = await deps.writeMergedEnvFile({
      repoRoot: repoSyncResult.path,
      env: installEnv,
      platform: platform.platform.platform,
      updates: {
        TELEGRAM_BOT_TOKEN: telegramSetup.botToken || undefined,
        TELEGRAM_ALLOWED_USER_IDS: telegramSetup.allowedUserIds.join(","),
        TELEGRAM_HOME_CHANNEL: telegramSetup.homeChannel || undefined,
        TELEGRAM_BOT_USERNAME: (botIdentity.username ?? knownBotUsername) || undefined
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
    if (telegramLookup.status === "validated") {
      updateStep({
        ...steps.find((step) => step.id === "telegram-bot")!,
        status: "passed",
        detail: botIdentity?.username
          ? `Connected to @${botIdentity.username}.`
          : "Bot token validated."
      });
    } else {
      if (telegramLookup.status === "warning") {
        warnings.push(`Telegram ${telegramLookup.step} warning: ${telegramLookup.message}`);
      } else if (telegramLookup.status === "not-attempted") {
        warnings.push("Telegram bot token is still missing; later setup/doctor will keep warning until it is added.");
      }
      updateStep({
        ...steps.find((step) => step.id === "telegram-bot")!,
        status: telegramLookup.status === "failed"
          ? "failed"
          : "warn",
        detail: telegramLookup.message
      });
    }

    updateStep({
      ...steps.find((step) => step.id === "background")!,
      status: "running",
      detail: `Configuring ${backgroundMode}.`
    });
    background = await deps.configureBackgroundMode({
      mode: backgroundMode,
      repoRoot: repoSyncResult.path,
      env: installEnv,
      platform: platform.platform.platform
    });
    updateStep({
      ...steps.find((step) => step.id === "background")!,
      status: background.status === "configured" ? "passed" : background.status === "failed" ? "failed" : background.status === "manual" ? "warn" : "skipped",
      detail: background.detail
    });

    const repoEnv = await buildRepoEnv(repoSyncResult.path, installEnv);
    const postCheckReports: InstallResult["postChecks"] = [];
    const postCheckWarnings: string[] = [];
    const postCheckNextSteps: string[] = [];
    const repeatedPostCheckSignatures = new Map<string, PostInstallCheck>();
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
        cwd: repoSyncResult.path,
        env: repoEnv,
        platform: platform.platform.platform
      });
      const repeatedSignature = bootstrapReportSignature(report);
      const repeatedFrom = repeatedSignature ? repeatedPostCheckSignatures.get(repeatedSignature) : undefined;
      const summary = bootstrapReportSummary(report);
      postCheckReports.push({
        command: check,
        status: statusFromBootstrapReport(report),
        summary: repeatedFrom
          ? `Same warning set as ${repeatedFrom}: ${summary}`
          : summary
      });
      pushUniqueLines(postCheckWarnings, warningMessagesFromBootstrapReport(report));
      pushUniqueNextSteps(postCheckNextSteps, nextStepsFromBootstrapReport(report));
      if (repeatedSignature && !repeatedFrom) {
        repeatedPostCheckSignatures.set(repeatedSignature, check);
      }
      updateStep({
        ...steps.find((step) => step.id === stepId)!,
        status: report.status === "pass" ? "passed" : report.status === "warn" ? "warn" : "failed",
        detail: repeatedFrom
          ? `No new warnings beyond \`${repeatedFrom}\`; the same warning set was confirmed.`
          : report.findings.length > 0 ? report.findings[0]!.message : "Environment looks ready."
      });
    }

    pushUniqueLines(warnings, postCheckWarnings);

    const finalEnvironment = await deps.detectInstallerEnvironment({
      cwd,
      env: installEnv,
      platform: platform.platform.platform,
      interactiveTerminal: false,
      repoRoot: installerRepoRoot
    });
    const partialFailure = createPartialFailureDetail(steps);
    const outcome = deriveInstallOutcome({
      warnings,
      steps,
      error: partialFailure
    });
    const pairTarget = pairTargetLabel(botIdentity?.username
      ? botIdentity
      : knownBotUsername
        ? {
          ok: false,
          username: knownBotUsername
        }
        : undefined);
    const finalNextSteps = nextSteps(repoSyncResult.path, pairTarget, backgroundMode);
    pushUniqueNextSteps(finalNextSteps, postCheckNextSteps);
    const result: InstallResult = {
      kind: "install",
      status: installStatusFromOutcome(outcome),
      outcome,
      interactive,
      tuiHandled: interactive,
      repo: {
        mode: repoMode,
        path: repoSyncResult.path,
        sync: repoSyncResult.sync,
        dirtyStrategy,
        source: repoSyncResult.repoSource,
        repoUrl: repoSyncResult.repoUrl,
        attempts: repoSyncResult.attempts,
        fallbackUsed: repoSyncResult.fallbackUsed
      },
      environment: finalEnvironment,
      telegram: {
        configured: Boolean(telegramSetup.botToken),
        allowedUserIds: telegramSetup.allowedUserIds,
        homeChannel: telegramSetup.homeChannel || undefined,
        bot: botIdentity,
        lookup: telegramLookup
      },
      background,
      postChecks: postCheckReports,
      steps,
      nextSteps: finalNextSteps,
      warnings,
      error: partialFailure,
      reportJson: {
        branch: options.branch,
        envWrite,
        botIdentity,
        telegramLookup,
        fallbackSource: repoSources.fallback?.url,
        fallbackUsed: repoSyncResult.fallbackUsed,
        outcome,
        pairTarget,
        packageManager: platform.platform.systemPackageManager,
        platform: platform.platform,
        repoSource: repoSyncResult.repoSource,
        repoUrl: repoSyncResult.repoUrl
      }
    };
    await writeInstallState(result, installEnv, platform.platform.platform);
    await saveDraft({
      repo: {
        mode: repoMode,
        dir: selectedChoice.path,
        path: repoSyncResult.path,
        source: repoSyncResult.repoSource,
        url: repoSyncResult.repoUrl,
        branch: options.branch,
        dirtyStrategy
      },
      telegram: telegramSetup,
      backgroundMode,
      postChecks
    });

    if (interactive) {
      await waitForEnter(stdin, stdout, renderSummaryScreen({
        outcome,
        repoPath: repoSyncResult.path,
        warnings,
        nextSteps: result.nextSteps,
        detail: outcome === "recoverable-failure"
          ? partialFailure?.lastError ?? installDetailFromBackground(background.detail)
          : installDetailFromBackground(background.detail),
        suggestedAction: partialFailure?.suggestedAction
      }));
    }

    return result;
  } catch (error) {
    return finalizeFailure(error);
  }
}
