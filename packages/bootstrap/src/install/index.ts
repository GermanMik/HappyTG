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
import {
  legacyNextStepsFromAutomation,
  onboardingItemsFromReport,
  pushAutomationItem,
  pushAutomationItems,
  type AutomationItem
} from "../finalization.js";

import { configureBackgroundMode } from "./background.js";
import { runCommand, runShellCommand, CommandExecutionError } from "./commands.js";
import { resolveInstallerRepoSources } from "./config.js";
import { writeMergedEnvFile } from "./env.js";
import { createInstallRuntimeError, isRetryableCommandOutput, toInstallRuntimeErrorDetail } from "./errors.js";
import { createStaticLaunchResult, launchAutomationItems, launchStepStatus, runDockerLaunch } from "./launch.js";
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
  promptPortConflictResolution,
  promptSelect,
  promptTelegramForm,
  renderBackgroundModeScreen,
  renderFinalScreen,
  renderDirtyWorktreeScreen,
  renderExistingEnvConfirmationScreen,
  renderLaunchModeScreen,
  renderPostCheckScreen,
  renderProgress,
  renderRepoModeScreen,
  renderSummaryScreen,
  renderWelcomeScreen,
  waitForEnter
} from "./tui.js";
import type { ExistingEnvReuseChoice, ExistingEnvValuePreview } from "./tui.js";
import { evaluateInstallPairingDecision, fetchPairingHostStatus, pairingHandoffMessage } from "./pairing.js";
import { fetchTelegramBotIdentity, normalizeTelegramAllowedUserIds, pairTargetLabel, telegramLookupDiagnostic, validateTelegramBotToken } from "./telegram.js";
import type {
  BackgroundMode,
  InstallCommandOptions,
  InstallDraftState,
  InstallLaunchMode,
  InstallLaunchResult,
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
import type { CommandRunResult } from "./commands.js";

const DEFAULT_POST_CHECKS: PostInstallCheck[] = ["setup", "doctor", "verify"];
const PNPM_TOOLCHAIN_CHECK_MARKER = "HTG_PNPM_TOOLCHAIN_OK:";
const PNPM_TOOLCHAIN_CHECK_EVAL = `const value: number = 1; console.log('${PNPM_TOOLCHAIN_CHECK_MARKER}' + value)`;
const PNPM_TOOLCHAIN_CHECK_COMMAND = `pnpm exec tsx --eval "${PNPM_TOOLCHAIN_CHECK_EVAL}"`;

interface IgnoredBuildScriptsWarning {
  packages: string[];
  rawLine: string;
}

interface PnpmBuildScriptGuidance {
  approveBuildsSupported: boolean;
  pnpmVersion?: string;
  suggestedAction: string;
  solutions: string[];
}

interface PnpmToolchainCheckResult {
  ok: boolean;
  command: string;
  summary: string;
  lastError?: string;
}

interface PnpmIgnoredBuildScriptsAssessment extends IgnoredBuildScriptsWarning {
  guidance: PnpmBuildScriptGuidance;
  toolchain: PnpmToolchainCheckResult;
  warningMessage: string;
}

interface PnpmInstallResult extends CommandRunResult {
  ignoredBuildScripts?: PnpmIgnoredBuildScriptsAssessment;
}

interface InstallRuntimeDependencies {
  configureBackgroundMode: typeof configureBackgroundMode;
  detectInstallerEnvironment: typeof detectInstallerEnvironment;
  detectRepoModeChoices: typeof detectRepoModeChoices;
  fetchPairingHostStatus: typeof fetchPairingHostStatus;
  fetchTelegramBotIdentity: typeof fetchTelegramBotIdentity;
  readInstallDraft: typeof readInstallDraft;
  resolveExecutable: typeof resolveExecutable;
  runDockerLaunch: typeof runDockerLaunch;
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

function dedupeWarningsAgainstAutomationItems(warnings: readonly string[], automationItems: readonly AutomationItem[]): string[] {
  const nonWarningMessages = new Set(
    automationItems
      .filter((item) => item.kind !== "warning")
      .map((item) => item.message)
  );

  return warnings.filter((warning) => !nonWarningMessages.has(warning));
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

function automationItemsFromBootstrapReport(report: BootstrapReport): AutomationItem[] {
  return report.status === "pass" ? [] : onboardingItemsFromReport(report);
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

interface PlannedPortListenerReport {
  description?: string;
  kind?: string;
  service?: string;
  containerName?: string;
  image?: string;
}

interface PlannedPortReport {
  id: string;
  label: string;
  port: number;
  state: string;
  detail: string;
  overrideEnv?: string;
  service?: string;
  listener?: PlannedPortListenerReport;
  suggestedPort?: number;
  suggestedPorts?: number[];
}

interface AppliedPortOverride {
  id: string;
  label: string;
  fromPort: number;
  toPort: number;
  overrideEnv: string;
  envFilePath: string;
}

const dockerComposePublishedPortIds = new Set([
  "redis",
  "postgres",
  "minio-api",
  "minio-console",
  "caddy-http",
  "caddy-https",
  "prometheus",
  "grafana"
]);

function isPlannedPortReport(value: unknown): value is PlannedPortReport {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as PlannedPortReport).id === "string"
    && typeof (value as PlannedPortReport).label === "string"
    && typeof (value as PlannedPortReport).port === "number"
    && typeof (value as PlannedPortReport).state === "string"
    && typeof (value as PlannedPortReport).detail === "string";
}

function bootstrapPortReports(report: BootstrapReport): PlannedPortReport[] {
  const ports = (report.reportJson as { ports?: unknown }).ports;
  return Array.isArray(ports)
    ? ports.filter(isPlannedPortReport)
    : [];
}

function suggestedPortsForReport(port: PlannedPortReport): number[] {
  const rawSuggestions: Array<number | undefined> = [
    ...(Array.isArray(port.suggestedPorts) ? port.suggestedPorts : []),
    port.suggestedPort
  ];

  return [...new Set(
    rawSuggestions.filter((value): value is number =>
      value !== undefined
      && Number.isInteger(value)
      && value > 0
      && value <= 65_535
    )
  )].slice(0, 3);
}

function portOwnerDescription(port: PlannedPortReport): string {
  return port.listener?.description
    ?? (port.service ? `HappyTG ${port.service}` : "another process or listener");
}

function portConflictClassification(port: PlannedPortReport): string {
  if (port.state === "occupied_expected") {
    return `Supported reuse: HappyTG ${port.service ?? port.label} is already running on this port.`;
  }
  if (port.state === "occupied_supported") {
    return `Supported reuse: ${portOwnerDescription(port)} is already available on this port.`;
  }
  if (port.service) {
    return `Conflict: HappyTG ${port.service} is already using this port, not ${port.label}.`;
  }
  if (["redis", "postgres", "minio"].includes(port.listener?.kind ?? "")) {
    return `Conflict: ${portOwnerDescription(port)} is using this port, but it is not the expected ${port.label} listener.`;
  }

  return `Conflict: ${portOwnerDescription(port)} is using this port.`;
}

function validateManualPortSelection(value: string, current: PlannedPortReport, ports: PlannedPortReport[]): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return "Enter a whole-number port between 1 and 65535.";
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return "Enter a whole-number port between 1 and 65535.";
  }
  if (port === current.port) {
    return `Port ${port} is already occupied for ${current.label}. Choose a different port.`;
  }

  const conflictingPlannedPort = ports.find((item) => item.id !== current.id && item.port === port);
  if (conflictingPlannedPort) {
    return `Port ${port} is already planned for ${conflictingPlannedPort.label}. Choose a different port.`;
  }

  return undefined;
}

function isLocalMiniAppUrl(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    return (url.protocol === "http:" || url.protocol === "https:")
      && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldRefreshLocalCorsOrigins(value: string | undefined): boolean {
  const origins = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return origins.length === 0 || origins.every(isLocalMiniAppUrl);
}

function portOverrideEnvUpdates(conflict: PlannedPortReport, selectedPort: number, repoEnv: NodeJS.ProcessEnv): Record<string, string> {
  const updates: Record<string, string> = {
    [conflict.overrideEnv!]: String(selectedPort)
  };

  if (conflict.overrideEnv === "HAPPYTG_MINIAPP_PORT") {
    if (isLocalMiniAppUrl(repoEnv.HAPPYTG_APP_URL)) {
      updates.HAPPYTG_APP_URL = `http://localhost:${selectedPort}`;
    }
    if (shouldRefreshLocalCorsOrigins(repoEnv.HAPPYTG_DEV_CORS_ORIGINS)) {
      updates.HAPPYTG_DEV_CORS_ORIGINS = `http://localhost:${selectedPort},http://127.0.0.1:${selectedPort}`;
    }
  }

  return updates;
}

function unresolvedPortConflicts(ports: PlannedPortReport[]): PlannedPortReport[] {
  return ports.filter((port) => port.state === "occupied_external" && Boolean(port.overrideEnv));
}

function dockerComposePublishConflicts(ports: PlannedPortReport[]): PlannedPortReport[] {
  return ports.filter((port) =>
    dockerComposePublishedPortIds.has(port.id)
    && port.state !== "free"
    && port.state !== "occupied_expected"
    && Boolean(port.overrideEnv)
  );
}

function summarizePortPreflight(ports: PlannedPortReport[], appliedOverrides: AppliedPortOverride[]): string {
  const free = ports.filter((item) => item.state === "free").map((item) => `${item.label} ${item.port}`);
  const reuse = ports
    .filter((item) => item.state === "occupied_expected" || item.state === "occupied_supported")
    .map((item) => `${item.label} ${item.port}`);
  const conflicts = unresolvedPortConflicts(ports).map((item) => `${item.label} ${item.port}`);
  const lines = [
    conflicts.length > 0
      ? `Planned port conflicts remain: ${conflicts.join(", ")}.`
      : "Planned port preflight is clear."
  ];

  if (reuse.length > 0) {
    lines.push(`Supported reuse: ${reuse.join(", ")}.`);
  }
  if (free.length > 0) {
    lines.push(`Free: ${free.join(", ")}.`);
  }
  if (appliedOverrides.length > 0) {
    lines.push(`Saved overrides in ${appliedOverrides[0]!.envFilePath}: ${appliedOverrides.map((item) => `${item.overrideEnv}=${item.toPort}`).join(", ")}.`);
  }

  return lines.join("\n");
}

function portPreflightAutomationItems(appliedOverrides: AppliedPortOverride[]): AutomationItem[] {
  const items: AutomationItem[] = appliedOverrides.map((item) => ({
    id: `port-preflight-${item.id}`,
    kind: "auto",
    message: `Saved \`${item.overrideEnv}=${item.toPort}\` in \`${item.envFilePath}\` so ${item.label} avoids occupied port ${item.fromPort}.`
  }));
  const caddyOverrides = appliedOverrides.filter((item) => item.overrideEnv === "HAPPYTG_HTTP_PORT" || item.overrideEnv === "HAPPYTG_HTTPS_PORT");
  if (caddyOverrides.length > 0) {
    const httpsOverride = caddyOverrides.find((item) => item.overrideEnv === "HAPPYTG_HTTPS_PORT");
    items.push({
      id: "caddy-public-port-remap",
      kind: "warning",
      message: httpsOverride
        ? `Caddy was remapped to HTTPS host port ${httpsOverride.toPort}. Local Docker startup can continue, but Telegram Mini App production routing still requires a public HTTPS URL; include the explicit port in \`HAPPYTG_PUBLIC_URL\` or \`HAPPYTG_MINIAPP_URL\` before running \`pnpm happytg telegram menu set\`.`
        : "Caddy HTTP was remapped for local Docker startup. This does not prove Telegram Mini App production readiness; `pnpm happytg telegram menu set` still requires a public HTTPS `/miniapp` URL that reaches HappyTG Caddy."
    });
  }
  return items;
}

async function resolvePortConflictsBeforePostChecks(input: {
  interactive: boolean;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  launchMode: InstallLaunchMode;
  repoPath: string;
  repoEnv: NodeJS.ProcessEnv;
  installEnv: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  runBootstrapCheck: (command: PostInstallCheck, context?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }) => Promise<BootstrapReport>;
  updateProgressDetail?: (detail: string) => void;
  writeMergedEnvFileImpl: typeof writeMergedEnvFile;
}): Promise<{
  report: BootstrapReport;
  repoEnv: NodeJS.ProcessEnv;
  appliedOverrides: AppliedPortOverride[];
  unresolvedConflicts: PlannedPortReport[];
  detail: string;
}> {
  const repoEnv: NodeJS.ProcessEnv = {
    ...input.repoEnv
  };
  const appliedOverrides: AppliedPortOverride[] = [];
  let report = await input.runBootstrapCheck("setup", {
    cwd: input.repoPath,
    env: repoEnv,
    platform: input.platform
  });
  const dockerAutoRemapped = new Set<string>();

  while (input.launchMode === "docker") {
    const ports = bootstrapPortReports(report);
    const conflict = dockerComposePublishConflicts(ports)
      .find((item) => item.overrideEnv && !dockerAutoRemapped.has(item.overrideEnv));
    if (!conflict?.overrideEnv) {
      break;
    }

    const selectedPort = suggestedPortsForReport(conflict)[0];
    if (!selectedPort) {
      break;
    }

    dockerAutoRemapped.add(conflict.overrideEnv);
    input.updateProgressDetail?.(
      `Saving \`${conflict.overrideEnv}=${selectedPort}\` in ${path.join(input.repoPath, ".env")} so Docker Compose does not publish ${conflict.label} on occupied port ${conflict.port}.\nRe-running planned port preflight so the installer can continue.`
    );
    const updates = portOverrideEnvUpdates(conflict, selectedPort, repoEnv);
    const envWrite = await input.writeMergedEnvFileImpl({
      repoRoot: input.repoPath,
      env: input.installEnv,
      platform: input.platform,
      updates
    });
    appliedOverrides.push({
      id: conflict.id,
      label: conflict.label,
      fromPort: conflict.port,
      toPort: selectedPort,
      overrideEnv: conflict.overrideEnv,
      envFilePath: envWrite.envFilePath
    });
    Object.assign(repoEnv, updates);
    report = await input.runBootstrapCheck("setup", {
      cwd: input.repoPath,
      env: repoEnv,
      platform: input.platform
    });
  }

  while (input.interactive) {
    const ports = bootstrapPortReports(report);
    const conflict = unresolvedPortConflicts(ports)[0];
    if (!conflict?.overrideEnv) {
      return {
        report,
        repoEnv,
        appliedOverrides,
        unresolvedConflicts: [],
        detail: summarizePortPreflight(ports, appliedOverrides)
      };
    }

    const selectedPort = await promptPortConflictResolution({
      stdin: input.stdin,
      stdout: input.stdout,
      serviceLabel: conflict.label,
      occupiedPort: conflict.port,
      detectedOwner: portOwnerDescription(conflict),
      classification: portConflictClassification(conflict),
      detail: conflict.detail,
      suggestedPorts: suggestedPortsForReport(conflict),
      overrideEnv: conflict.overrideEnv,
      envFilePath: path.join(input.repoPath, ".env"),
      validateManualPort: (value) => validateManualPortSelection(value, conflict, ports)
    });
    if (selectedPort === undefined) {
      throw createInstallRuntimeError({
        code: "installer_validation_failure",
        message: `${conflict.label} port conflict was left unresolved.`,
        lastError: `Install stopped because ${conflict.label} could not reuse occupied port ${conflict.port}.`,
        retryable: true,
        suggestedAction: `Free port ${conflict.port}, rerun the installer, or start again and pick a different ${conflict.overrideEnv} value when prompted.`
      });
    }

    input.updateProgressDetail?.(
      `Saving \`${conflict.overrideEnv}=${selectedPort}\` in ${path.join(input.repoPath, ".env")}.\nRe-running planned port preflight so the installer can continue.`
    );
    const updates = portOverrideEnvUpdates(conflict, selectedPort, repoEnv);
    const envWrite = await input.writeMergedEnvFileImpl({
      repoRoot: input.repoPath,
      env: input.installEnv,
      platform: input.platform,
      updates
    });
    appliedOverrides.push({
      id: conflict.id,
      label: conflict.label,
      fromPort: conflict.port,
      toPort: selectedPort,
      overrideEnv: conflict.overrideEnv,
      envFilePath: envWrite.envFilePath
    });
    Object.assign(repoEnv, updates);
    report = await input.runBootstrapCheck("setup", {
      cwd: input.repoPath,
      env: repoEnv,
      platform: input.platform
    });
  }

  const ports = bootstrapPortReports(report);
  return {
    report,
    repoEnv,
    appliedOverrides,
    unresolvedConflicts: unresolvedPortConflicts(ports),
    detail: summarizePortPreflight(ports, appliedOverrides)
  };
}

function removeAutomationItems(items: AutomationItem[], ...ids: string[]): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (ids.includes(items[index]!.id)) {
      items.splice(index, 1);
    }
  }
}

function manualPairingFallbackRequestMessage(input: {
  reason: "probe-unavailable" | "request-failed";
  hasExistingHost: boolean;
}): string {
  if (input.reason === "probe-unavailable" && input.hasExistingHost) {
    return "The installer could not confirm whether the existing local host is already paired. If this host still needs pairing, request a fresh code manually with `pnpm daemon:pair`.";
  }

  if (input.hasExistingHost) {
    return "The installer could not refresh the existing host pairing code automatically. When the HappyTG API is reachable, request a fresh code manually with `pnpm daemon:pair`.";
  }

  return "The installer could not request a pairing code automatically. When the HappyTG API is reachable, request one manually with `pnpm daemon:pair`.";
}

function manualPairingFallbackHandoffMessage(pairTarget: string): string {
  return pairTarget.toLowerCase().includes("telegram")
    ? "If `pnpm daemon:pair` prints a code, send the returned `/pair CODE` command in Telegram."
    : `If \`pnpm daemon:pair\` prints a code, send the returned \`/pair CODE\` command to ${pairTarget}.`;
}

async function buildInstallFinalizationItems(input: {
  background: InstallResult["background"];
  fetchImpl?: typeof fetch;
  fetchPairingHostStatusImpl: typeof fetchPairingHostStatus;
  pairTarget: string;
  platform: NodeJS.Platform;
  postCheckItems: AutomationItem[];
  repoEnv: NodeJS.ProcessEnv;
  repoPath: string;
  resolveExecutableImpl: typeof resolveExecutable;
  runCommandImpl: typeof runCommand;
  telegramLookup: InstallResult["telegram"]["lookup"];
}): Promise<AutomationItem[]> {
  const items: AutomationItem[] = [];
  pushAutomationItems(items, input.postCheckItems);

  if (input.background.status === "configured") {
    pushAutomationItem(items, {
      id: "background-configured",
      kind: "auto",
      message: input.background.detail
    });
  } else if (input.background.status === "manual" && input.background.mode !== "manual" && input.background.mode !== "skip") {
    pushAutomationItem(items, {
      id: "background-configured",
      kind: "warning",
      message: input.background.detail
    });
  } else if (input.background.status === "failed") {
    pushAutomationItem(items, {
      id: "background-configured",
      kind: "blocked",
      message: input.background.detail
    });
  }

  if (input.telegramLookup?.status === "failed" || input.telegramLookup?.status === "not-attempted") {
    removeAutomationItems(items, "complete-pairing", "start-daemon");
    pushAutomationItem(items, {
      id: "request-pair-code",
      kind: "blocked",
      message: input.telegramLookup?.status === "failed"
        ? "Pairing remains blocked because Telegram bot validation failed."
        : "Pairing remains blocked because the Telegram bot token is missing.",
      solutions: input.telegramLookup?.status === "failed"
        ? [
          "Fix `TELEGRAM_BOT_TOKEN` in `.env` or the shell.",
          "Rerun `pnpm happytg install` after the bot token works."
        ]
        : [
          "Add `TELEGRAM_BOT_TOKEN` before pairing the host.",
          "Rerun `pnpm happytg install` after the token is set."
        ]
    });
  } else if (items.some((item) => item.id === "request-pair-code" && item.kind === "manual")) {
    const pairingDecision = await evaluateInstallPairingDecision({
      env: input.repoEnv,
      fetchImpl: input.fetchImpl,
      pairingRequested: true,
      platform: input.platform,
      repoPath: input.repoPath,
      resolveExecutableImpl: input.resolveExecutableImpl,
      runCommandImpl: input.runCommandImpl,
      fetchPairingHostStatusImpl: input.fetchPairingHostStatusImpl
    });

    switch (pairingDecision.state) {
      case "reuse-existing-host":
        removeAutomationItems(items, "complete-pairing", "pairing-auto-request");
        pushAutomationItem(items, {
          id: "request-pair-code",
          kind: "reuse",
          message: pairingDecision.probe.status === "active"
            ? "Existing host daemon state was detected locally, and the HappyTG API reports this host as active. Reuse it without requesting a new pairing code."
            : "Existing host daemon state was detected locally, and the HappyTG API reports this host as already paired. Reuse it without requesting a new pairing code."
        });
        break;
      case "auto-requested":
        removeAutomationItems(items, "pairing-auto-request");
        pushAutomationItem(items, {
          id: "request-pair-code",
          kind: "auto",
          message: pairingDecision.reason === "host-refresh-required"
            ? pairingDecision.pairResult.expiresAt
              ? `Refreshed the existing host pairing code on the execution host. It expires at ${pairingDecision.pairResult.expiresAt}.`
              : "Refreshed the existing host pairing code on the execution host."
            : pairingDecision.pairResult.expiresAt
              ? `Requested a pairing code on the execution host. It expires at ${pairingDecision.pairResult.expiresAt}.`
              : "Requested a pairing code on the execution host."
        });
        pushAutomationItem(items, {
          id: "complete-pairing",
          kind: "manual",
          message: pairingHandoffMessage(input.pairTarget, pairingDecision.pairResult.pairingCode)
        });
        break;
      case "manual-fallback":
        pushAutomationItem(items, {
          id: "request-pair-code",
          kind: "manual",
          message: manualPairingFallbackRequestMessage({
            reason: pairingDecision.reason,
            hasExistingHost: Boolean(pairingDecision.daemonState.hostId)
          })
        });
        pushAutomationItem(items, {
          id: "complete-pairing",
          kind: "manual",
          message: manualPairingFallbackHandoffMessage(input.pairTarget)
        });
        pushAutomationItem(items, {
          id: "pairing-auto-request",
          kind: "warning",
          message: pairingDecision.reason === "probe-unavailable" && pairingDecision.daemonState.hostId
            ? "Existing host daemon state was detected locally, but the installer could not confirm its pairing state automatically."
            : pairingDecision.daemonState.hostId
              ? "Automatic pairing-code refresh did not complete."
              : "Automatic pairing-code request did not complete."
        });
        break;
      case "not-required":
      default:
        break;
    }
  }

  const pairingBlocked = items.some((item) => item.id === "request-pair-code" && item.kind === "blocked");
  if (pairingBlocked) {
    removeAutomationItems(items, "complete-pairing", "start-daemon");
  }

  const pairingPending = !pairingBlocked
    && items.some((item) => item.id === "complete-pairing"
      || (item.id === "request-pair-code" && item.kind === "manual"));

  if (input.background.status === "configured") {
    removeAutomationItems(items, "start-daemon");
    if (!pairingBlocked && (input.background.mode === "scheduled-task" || input.background.mode === "startup")) {
      pushAutomationItem(items, {
        id: "background-activation",
        kind: "warning",
        message: pairingPending
          ? "The host daemon background launcher is configured for the next logon. If you need it immediately after pairing, run `pnpm dev:daemon` once."
          : "The host daemon background launcher is configured for the next logon. If you need it immediately, run `pnpm dev:daemon` once."
      });
    }
  } else if (!pairingBlocked && input.background.status === "manual") {
    pushAutomationItem(items, {
      id: "start-daemon",
      kind: "manual",
      message: pairingPending
        ? "After pairing, start the daemon with `pnpm dev:daemon`."
        : "Start the daemon with `pnpm dev:daemon`."
    });
  } else if (!pairingBlocked && input.background.status === "failed") {
    pushAutomationItem(items, {
      id: "start-daemon",
      kind: "blocked",
      message: pairingPending
        ? "Background launcher setup failed. After pairing, start the daemon manually with `pnpm dev:daemon`."
        : "Background launcher setup failed. Start the daemon manually with `pnpm dev:daemon`."
    });
  }

  return items;
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

const existingEnvLocalUrlKeys = [
  "HAPPYTG_PUBLIC_URL",
  "HAPPYTG_MINIAPP_URL",
  "HAPPYTG_APP_URL",
  "HAPPYTG_API_URL",
  "HAPPYTG_BROWSER_API_URL"
] as const;

const existingEnvPortOverrideKeys = [
  "HAPPYTG_MINIAPP_PORT",
  "HAPPYTG_API_PORT",
  "HAPPYTG_BOT_PORT",
  "HAPPYTG_WORKER_PORT",
  "HAPPYTG_POSTGRES_HOST_PORT",
  "HAPPYTG_REDIS_HOST_PORT",
  "HAPPYTG_MINIO_PORT",
  "HAPPYTG_MINIO_CONSOLE_PORT",
  "HAPPYTG_HTTP_PORT",
  "HAPPYTG_HTTPS_PORT"
] as const;

interface ExistingInstallEnvSetup {
  envFilePath: string;
  telegram: TelegramSetup & { botUsername?: string };
  previewValues: ExistingEnvValuePreview[];
}

function isLocalUrlPreviewValue(rawValue: string): boolean {
  try {
    const url = new URL(rawValue);
    return url.hostname === "localhost"
      || url.hostname.endsWith(".localhost")
      || url.hostname === "127.0.0.1"
      || url.hostname === "0.0.0.0"
      || url.hostname === "::1"
      || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

function existingEnvHasReusableTelegramValues(input: ExistingInstallEnvSetup): boolean {
  return Boolean(input.telegram.botToken);
}

async function readExistingInstallEnvSetup(repoPath: string): Promise<ExistingInstallEnvSetup> {
  const envFilePath = path.join(repoPath, ".env");
  const envText = await readTextFileOrEmpty(envFilePath);
  const parsed = envText ? parseDotEnv(envText) : {};
  const previewValues: ExistingEnvValuePreview[] = [];

  for (const key of existingEnvLocalUrlKeys) {
    const value = parsed[key]?.trim() ?? "";
    if (value && isLocalUrlPreviewValue(value)) {
      previewValues.push({
        key,
        value,
        detail: "Local URL."
      });
    }
  }

  for (const key of existingEnvPortOverrideKeys) {
    const value = parsed[key]?.trim() ?? "";
    if (value) {
      previewValues.push({
        key,
        value,
        detail: "Port override."
      });
    }
  }

  return {
    envFilePath,
    telegram: {
      botToken: parsed.TELEGRAM_BOT_TOKEN ?? "",
      allowedUserIds: normalizeTelegramAllowedUserIds([parsed.TELEGRAM_ALLOWED_USER_IDS ?? ""]),
      homeChannel: parsed.TELEGRAM_HOME_CHANNEL ?? "",
      botUsername: parsed.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "") || undefined
    },
    previewValues
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

function launchOptionsForInstall(): Array<{ mode: InstallLaunchMode; label: string; detail: string }> {
  return [
    {
      mode: "local",
      label: "Local dev",
      detail: "Do not start containers; final guidance uses `pnpm dev`, `pnpm daemon:pair`, and `pnpm dev:daemon`."
    },
    {
      mode: "docker",
      label: "Docker Compose",
      detail: "Validate and start the packaged control-plane stack with `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d`."
    },
    {
      mode: "manual",
      label: "Manual",
      detail: "Do not start anything automatically; print exact local and Docker startup commands."
    },
    {
      mode: "skip",
      label: "Skip",
      detail: "No startup action beyond install and selected post-checks."
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

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/gu, "");
}

function normalizedCommandOutput(result: Pick<CommandRunResult, "stdout" | "stderr">): string {
  return stripAnsi(`${result.stdout}\n${result.stderr}`)
    .replace(/\r\n/gu, "\n")
    .trim();
}

function normalizeIgnoredBuildScriptPackages(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((item) => item.trim().replace(/[.]+$/u, ""))
    .filter(Boolean);
}

function stripPackageVersion(specifier: string): string {
  const trimmed = specifier.trim().replace(/[.]+$/u, "");
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("@")) {
    const separatorIndex = trimmed.lastIndexOf("@");
    return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : trimmed;
  }

  const separatorIndex = trimmed.indexOf("@");
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : trimmed;
}

function formatPackageList(packages: readonly string[]): string {
  if (packages.length === 0) {
    return "the reported packages";
  }

  return packages.map((item) => `\`${item}\``).join(", ");
}

function parseIgnoredBuildScriptsWarning(output: string): IgnoredBuildScriptsWarning | undefined {
  const lines = stripAnsi(output)
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = /ignored build scripts:\s*(.+)$/iu.exec(line)
      ?? /dependencies have build scripts that were ignored:\s*(.+)$/iu.exec(line);
    if (!match) {
      continue;
    }

    const packages = normalizeIgnoredBuildScriptPackages(match[1] ?? "");
    return {
      packages,
      rawLine: line
    };
  }

  return undefined;
}

async function detectPnpmBuildScriptGuidance(input: {
  pnpmPath: string;
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  packages: readonly string[];
  runCommandImpl: typeof runCommand;
}): Promise<PnpmBuildScriptGuidance> {
  let pnpmVersion: string | undefined;
  try {
    const versionRun = await input.runCommandImpl({
      command: input.pnpmPath,
      args: ["--version"],
      cwd: input.repoPath,
      env: input.env,
      platform: input.platform
    });
    if (versionRun.exitCode === 0) {
      pnpmVersion = stripAnsi(versionRun.stdout).split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    }
  } catch {
    pnpmVersion = undefined;
  }

  let approveBuildsSupported = false;
  try {
    const helpRun = await input.runCommandImpl({
      command: input.pnpmPath,
      args: ["help", "approve-builds"],
      cwd: input.repoPath,
      env: input.env,
      platform: input.platform
    });
    const helpOutput = normalizedCommandOutput(helpRun);
    approveBuildsSupported = helpRun.exitCode === 0 && !/no results for "approve-builds"/iu.test(helpOutput);
  } catch {
    approveBuildsSupported = false;
  }

  const packageList = formatPackageList(input.packages);
  const rebuildTargets = [...new Set(input.packages.map(stripPackageVersion).filter(Boolean))];
  const rebuildCommand = rebuildTargets.length > 0
    ? `pnpm rebuild ${rebuildTargets.join(" ")}`
    : "pnpm rebuild";
  if (approveBuildsSupported) {
    return {
      approveBuildsSupported,
      pnpmVersion,
      suggestedAction: `Run \`pnpm approve-builds\` in the checkout, allow ${packageList}, run \`${rebuildCommand}\`, then rerun the installer.`,
      solutions: [
        `Review blocked build scripts with \`pnpm approve-builds\` in the checkout.`,
        `After allowing the required packages, run \`${rebuildCommand}\`.`,
        "Rerun `pnpm happytg install` or `pnpm happytg doctor --json` once the toolchain is healthy."
      ]
    };
  }

  const versionLabel = pnpmVersion ? ` (${pnpmVersion})` : "";
  return {
    approveBuildsSupported,
    pnpmVersion,
    suggestedAction: `This pnpm runtime${versionLabel} does not support \`pnpm approve-builds\`. Allow ${packageList} in the pnpm build-script policy for this checkout, run \`${rebuildCommand}\`, then rerun the installer.`,
    solutions: [
      `This pnpm runtime${versionLabel} does not support \`pnpm approve-builds\`.`,
      `Allow ${packageList} in the pnpm build-script policy for this checkout.`,
      `After allowing the required packages, run \`${rebuildCommand}\`.`
    ]
  };
}

async function runCriticalPnpmToolchainCheck(input: {
  pnpmPath: string;
  repoPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  runCommandImpl: typeof runCommand;
}): Promise<PnpmToolchainCheckResult> {
  try {
    const result = await input.runCommandImpl({
      command: input.pnpmPath,
      args: ["exec", "tsx", "--eval", PNPM_TOOLCHAIN_CHECK_EVAL],
      cwd: input.repoPath,
      env: input.env,
      platform: input.platform
    });
    if (result.exitCode === 0 && stripAnsi(result.stdout).includes(`${PNPM_TOOLCHAIN_CHECK_MARKER}1`)) {
      return {
        ok: true,
        command: PNPM_TOOLCHAIN_CHECK_COMMAND,
        summary: `Critical \`tsx\` + \`esbuild\` path is usable (\`${PNPM_TOOLCHAIN_CHECK_COMMAND}\`).`
      };
    }

    const lastError = normalizedCommandOutput(result) || "The `tsx` + `esbuild` toolchain check did not complete successfully.";
    return {
      ok: false,
      command: PNPM_TOOLCHAIN_CHECK_COMMAND,
      summary: `Critical \`tsx\` + \`esbuild\` path failed after install (\`${PNPM_TOOLCHAIN_CHECK_COMMAND}\`).`,
      lastError
    };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "The `tsx` + `esbuild` toolchain check could not start.";
    return {
      ok: false,
      command: PNPM_TOOLCHAIN_CHECK_COMMAND,
      summary: `Critical \`tsx\` + \`esbuild\` path failed after install (\`${PNPM_TOOLCHAIN_CHECK_COMMAND}\`).`,
      lastError
    };
  }
}

async function runPnpmInstall(input: {
  repoPath: string;
  pnpmPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  updateStep: (next: InstallStepRecord) => void;
  step: InstallStepRecord;
  runCommandImpl: typeof runCommand;
}): Promise<PnpmInstallResult> {
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
      const ignoredBuildScripts = parseIgnoredBuildScriptsWarning(normalizedCommandOutput(result));
      if (!ignoredBuildScripts) {
        return result;
      }

      const guidance = await detectPnpmBuildScriptGuidance({
        pnpmPath: input.pnpmPath,
        repoPath: input.repoPath,
        env: input.env,
        platform: input.platform,
        packages: ignoredBuildScripts.packages,
        runCommandImpl: input.runCommandImpl
      });
      const toolchain = await runCriticalPnpmToolchainCheck({
        pnpmPath: input.pnpmPath,
        repoPath: input.repoPath,
        env: input.env,
        platform: input.platform,
        runCommandImpl: input.runCommandImpl
      });
      const warningMessage = toolchain.ok
        ? `pnpm ignored build scripts for ${formatPackageList(ignoredBuildScripts.packages)}, but HappyTG verified that the critical \`tsx\` + \`esbuild\` path is usable in this checkout.`
        : `pnpm ignored build scripts for ${formatPackageList(ignoredBuildScripts.packages)}, and the critical \`tsx\` + \`esbuild\` path is not usable in this checkout.`;
      if (!toolchain.ok) {
        throw createInstallRuntimeError({
          code: "pnpm_install_failed",
          message: "pnpm install left the critical tsx/esbuild toolchain unusable.",
          lastError: `${warningMessage}\n${toolchain.lastError ?? toolchain.summary}`,
          retryable: false,
          suggestedAction: guidance.suggestedAction,
          failedCommand: "pnpm install",
          failedBinary: "pnpm",
          binaryPath: result.binaryPath
        });
      }

      return {
        ...result,
        ignoredBuildScripts: {
          ...ignoredBuildScripts,
          guidance,
          toolchain,
          warningMessage
        }
      };
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
    launch: createStaticLaunchResult(input.options.launchMode ?? "local"),
    postChecks: [],
    steps: [],
    nextSteps: [],
    warnings: [],
    error: detail,
    reportJson: {
      branch: input.options.branch,
      error: detail,
      launch: createStaticLaunchResult(input.options.launchMode ?? "local"),
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
    fetchPairingHostStatus,
    fetchTelegramBotIdentity,
    readInstallDraft,
    resolveExecutable,
    runDockerLaunch,
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
    launchMode?: InstallLaunchMode;
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
        launchMode: patch.launchMode ?? draft?.launchMode,
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

  const repoExistingEnv = await readExistingInstallEnvSetup(selectedChoice?.path ?? repoChoices.clonePath).catch(() => ({
    envFilePath: path.join(selectedChoice?.path ?? repoChoices.clonePath, ".env"),
    telegram: {
      botToken: "",
      allowedUserIds: [],
      homeChannel: "",
      botUsername: undefined
    },
    previewValues: []
  }));
  const repoTelegramDefaults = repoExistingEnv.telegram;
  let knownBotUsername = "";
  const cliTelegramAllowedUserIds = options.telegramAllowedUserIds.length > 0
    ? normalizeTelegramAllowedUserIds(options.telegramAllowedUserIds)
    : undefined;
  const telegramInitial: TelegramSetup = {
    botToken: interactive
      ? options.telegramBotToken ?? ""
      : options.telegramBotToken ?? draft?.telegram?.botToken ?? repoTelegramDefaults.botToken,
    allowedUserIds: interactive
      ? cliTelegramAllowedUserIds ?? []
      : cliTelegramAllowedUserIds ?? draft?.telegram?.allowedUserIds ?? repoTelegramDefaults.allowedUserIds,
    homeChannel: interactive
      ? options.telegramHomeChannel ?? ""
      : options.telegramHomeChannel ?? draft?.telegram?.homeChannel ?? repoTelegramDefaults.homeChannel
  };
  let telegramSetup = telegramInitial;
  const backgroundModes = backgroundOptionsForPlatform(platform.platform.platform);
  const backgroundDefault = options.backgroundMode ?? draft?.backgroundMode ?? backgroundModes[0]!.mode;
  let backgroundMode = backgroundDefault;
  const launchModes = launchOptionsForInstall();
  const launchDefault = options.launchMode ?? draft?.launchMode ?? "local";
  let launchMode = launchDefault;
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
  let launch: InstallLaunchResult = createStaticLaunchResult(launchMode);
  let repoEnv: NodeJS.ProcessEnv | undefined;
  let preflightSetupReport: BootstrapReport | undefined;
  let portPreflightDetail = "Planned port preflight did not run.";
  let appliedPortOverrides: AppliedPortOverride[] = [];
  let preflightConflictItems: AutomationItem[] = [];
  let pnpmInstallAssessment: PnpmIgnoredBuildScriptsAssessment | undefined;
  const pnpmInstallAutomationItems: AutomationItem[] = [];

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
      launch,
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
        launch,
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
    if (interactive) {
      const existingEnvChoice: ExistingEnvReuseChoice = existingEnvHasReusableTelegramValues(repoExistingEnv)
        ? await promptSelect({
          stdin,
          stdout,
          items: ["reuse", "edit"],
          initial: "reuse",
          render: (active) => renderExistingEnvConfirmationScreen({
            envFilePath: repoExistingEnv.envFilePath,
            telegram: repoTelegramDefaults,
            values: repoExistingEnv.previewValues,
            activeChoice: active
          })
        })
        : "edit";

      if (existingEnvChoice === "reuse") {
        telegramSetup = {
          botToken: repoTelegramDefaults.botToken,
          allowedUserIds: [...repoTelegramDefaults.allowedUserIds],
          homeChannel: repoTelegramDefaults.homeChannel
        };
        knownBotUsername = repoTelegramDefaults.botUsername ?? "";
      } else {
        telegramSetup = await promptTelegramForm({
          stdin,
          stdout,
          initial: telegramInitial
        });
      }
    } else {
      telegramSetup = telegramInitial;
      knownBotUsername = repoTelegramDefaults.botUsername ?? "";
    }
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
    launchMode = interactive
      ? await promptSelect({
        stdin,
        stdout,
        items: launchModes.map((mode) => mode.mode),
        initial: launchDefault,
        render: (activeMode) => renderLaunchModeScreen({
          activeMode,
          modes: launchModes
        })
      })
      : launchDefault;
    launch = createStaticLaunchResult(launchMode);
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
      launchMode,
      postChecks
    });
    steps = [
      createStep("repo-sync", "Sync repository", `${repoMode} -> ${selectedChoice.path}`),
      ...platform.dependencies.map((dependency) => createStep(`dep-${dependency.id}`, dependency.label, dependency.available ? "Already available." : dependency.installCommand ?? dependency.manualInstruction ?? "Manual follow-up required.")),
      createStep("pnpm-install", "Install workspace dependencies", "Run `pnpm install` in the selected checkout."),
      createStep("env-merge", "Merge environment", "Create or merge `.env` without overwriting existing values."),
      createStep("port-preflight", "Resolve planned ports", "Check planned HappyTG ports before later startup guidance."),
      createStep("telegram-bot", "Connect Telegram bot", "Validate the token and capture bot identity for later /pair guidance."),
      createStep("background", "Configure background run mode", backgroundModes.find((item) => item.mode === backgroundMode)?.detail ?? backgroundMode),
      createStep("launch", "Launch control-plane stack", launchModes.find((item) => item.mode === launchMode)?.detail ?? launchMode),
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

      if (dependency.id === "docker") {
        updateStep({
          ...steps.find((step) => step.id === stepId)!,
          status: launchMode === "docker" ? "warn" : "skipped",
          detail: launchMode === "docker"
            ? "Docker launch was selected; Docker will be verified during the launch step with actionable recovery guidance."
            : "Optional for Docker launch; not needed for the selected launch mode."
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
    pnpmInstallAssessment = pnpmInstallRun.ignoredBuildScripts;
    if (pnpmInstallAssessment) {
      warnings.push(pnpmInstallAssessment.warningMessage);
      pnpmInstallAutomationItems.push({
        id: "pnpm-ignored-build-scripts",
        kind: "warning",
        message: pnpmInstallAssessment.warningMessage,
        solutions: pnpmInstallAssessment.guidance.solutions
      });
      updateStep({
        ...pnpmInstallStep,
        status: "warn",
        detail: [
          pnpmInstallRun.fallbackUsed
            ? "Workspace dependencies installed after recovering from a Windows shim launch issue, but pnpm reported ignored build scripts."
            : "Workspace dependencies installed, but pnpm reported ignored build scripts.",
          `Packages: ${pnpmInstallAssessment.packages.join(", ") || "reported packages"}.`,
          pnpmInstallAssessment.toolchain.summary,
          pnpmInstallAssessment.guidance.approveBuildsSupported
            ? "Runtime guidance: `pnpm approve-builds` is available for this pnpm runtime."
            : `Runtime guidance: \`pnpm approve-builds\` is not available${pnpmInstallAssessment.guidance.pnpmVersion ? ` in pnpm ${pnpmInstallAssessment.guidance.pnpmVersion}` : " in this pnpm runtime"}.`
        ].join("\n")
      });
    } else {
      updateStep({
        ...pnpmInstallStep,
        status: "passed",
        detail: pnpmInstallRun.fallbackUsed
          ? "Workspace dependencies installed after recovering from a Windows shim launch issue."
          : "Workspace dependencies installed."
      });
    }

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

    repoEnv = await buildRepoEnv(repoSyncResult.path, installEnv);
    updateStep({
      ...steps.find((step) => step.id === "port-preflight")!,
      status: "running",
      detail: "Checking planned HappyTG ports before post-install startup guidance."
    });
    if (!input?.runBootstrapCheck) {
      portPreflightDetail = "Bootstrap preflight runner is not available in this execution path.";
      updateStep({
        ...steps.find((step) => step.id === "port-preflight")!,
        status: "skipped",
        detail: portPreflightDetail
      });
    } else {
      const portPreflight = await resolvePortConflictsBeforePostChecks({
        interactive,
        stdin,
        stdout,
        launchMode,
        repoPath: repoSyncResult.path,
        repoEnv,
        installEnv,
        platform: platform.platform.platform,
        runBootstrapCheck: input.runBootstrapCheck,
        updateProgressDetail: (detail) => updateStep({
          ...steps.find((step) => step.id === "port-preflight")!,
          status: "running",
          detail
        }),
        writeMergedEnvFileImpl: deps.writeMergedEnvFile
      });
      repoEnv = portPreflight.repoEnv;
      preflightSetupReport = portPreflight.report;
      appliedPortOverrides = portPreflight.appliedOverrides;
      portPreflightDetail = portPreflight.detail;
      preflightConflictItems = portPreflight.unresolvedConflicts.length > 0
        ? automationItemsFromBootstrapReport(portPreflight.report)
          .filter((item) => item.kind === "conflict" && item.id.endsWith("-port-conflict"))
        : [];
      updateStep({
        ...steps.find((step) => step.id === "port-preflight")!,
        status: portPreflight.unresolvedConflicts.length > 0 ? "warn" : "passed",
        detail: portPreflight.detail
      });
    }

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

    repoEnv ??= await buildRepoEnv(repoSyncResult.path, installEnv);
    updateStep({
      ...steps.find((step) => step.id === "launch")!,
      status: "running",
      detail: launchModes.find((item) => item.mode === launchMode)?.detail ?? launchMode
    });
    launch = launchMode === "docker"
      ? await deps.runDockerLaunch({
        repoPath: repoSyncResult.path,
        repoEnv,
        installEnv,
        platform: platform.platform.platform,
        fetchImpl: input?.fetchImpl,
        resolveExecutableImpl: deps.resolveExecutable,
        runCommandImpl: deps.runCommand
      })
      : createStaticLaunchResult(launchMode);
    pushUniqueLines(warnings, launch.warnings);
    updateStep({
      ...steps.find((step) => step.id === "launch")!,
      status: launchStepStatus(launch),
      detail: [
        launch.detail,
        launch.command ? `Command: \`${launch.command}\`.` : "",
        ...launch.health.map((item) => `${item.label}: ${item.detail}`)
      ].filter(Boolean).join("\n")
    });
    if (launch.mode === "docker") {
      preflightSetupReport = undefined;
    }

    const postCheckReports: InstallResult["postChecks"] = [];
    const postCheckWarnings: string[] = [];
    const postCheckAutomationItems: AutomationItem[] = [];
    const cachedPostCheckReports = new Map<PostInstallCheck, BootstrapReport>();
    if (preflightSetupReport) {
      cachedPostCheckReports.set("setup", preflightSetupReport);
    }
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

      const report = cachedPostCheckReports.get(check) ?? await input.runBootstrapCheck(check, {
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
      pushAutomationItems(postCheckAutomationItems, automationItemsFromBootstrapReport(report));
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
    const finalizationItems: AutomationItem[] = [];
    pushAutomationItems(finalizationItems, pnpmInstallAutomationItems);
    pushAutomationItems(finalizationItems, portPreflightAutomationItems(appliedPortOverrides));
    pushAutomationItems(finalizationItems, preflightConflictItems);
    pushAutomationItems(finalizationItems, launchAutomationItems(launch));
    pushAutomationItems(finalizationItems, await buildInstallFinalizationItems({
      background,
      fetchImpl: input?.fetchImpl,
      fetchPairingHostStatusImpl: deps.fetchPairingHostStatus,
      pairTarget,
      platform: platform.platform.platform,
      postCheckItems: postCheckAutomationItems,
      repoEnv,
      repoPath: repoSyncResult.path,
      resolveExecutableImpl: deps.resolveExecutable,
      runCommandImpl: deps.runCommand,
      telegramLookup
    }));
    if (finalizationItems.some((item) => item.id === "running-stack-reuse")) {
      removeAutomationItems(finalizationItems, "start-repo-services");
    }
    const finalWarnings = dedupeWarningsAgainstAutomationItems(warnings, finalizationItems);
    const finalNextSteps = legacyNextStepsFromAutomation(finalizationItems);
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
      launch,
      finalization: {
        items: finalizationItems
      },
      postChecks: postCheckReports,
      steps,
      nextSteps: finalNextSteps,
      warnings: finalWarnings,
      error: partialFailure,
      reportJson: {
        branch: options.branch,
        envWrite,
        botIdentity,
        telegramLookup,
        fallbackSource: repoSources.fallback?.url,
        fallbackUsed: repoSyncResult.fallbackUsed,
        outcome,
        launch,
        finalizationItems,
        pnpmInstall: pnpmInstallAssessment
          ? {
            ignoredBuildScripts: {
              packages: pnpmInstallAssessment.packages,
              rawLine: pnpmInstallAssessment.rawLine,
              pnpmVersion: pnpmInstallAssessment.guidance.pnpmVersion ?? null,
              approveBuildsSupported: pnpmInstallAssessment.guidance.approveBuildsSupported,
              toolchain: {
                ok: pnpmInstallAssessment.toolchain.ok,
                command: pnpmInstallAssessment.toolchain.command,
                summary: pnpmInstallAssessment.toolchain.summary,
                lastError: pnpmInstallAssessment.toolchain.lastError ?? null
              }
            }
          }
          : {
            ignoredBuildScripts: null
          },
        portPreflight: {
          detail: portPreflightDetail,
          appliedOverrides: appliedPortOverrides
        },
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
      launchMode,
      postChecks
    });

    if (interactive) {
      await waitForEnter(stdin, stdout, renderSummaryScreen({
        outcome,
        repoPath: repoSyncResult.path,
        finalizationItems,
        warnings: finalWarnings,
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
