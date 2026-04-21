#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BootstrapReport, TaskBundle } from "../../protocol/src/index.js";
import { initTaskBundle, readTaskBundle, taskBundlePath, validateTaskBundle } from "../../repo-proof/src/index.js";
import { loadHappyTGEnv } from "../../shared/src/index.js";

import {
  automationItemRenderLines,
  groupAutomationItems,
  onboardingItemsFromReport,
  type AutomationItem
} from "./finalization.js";
import { createInstallFailureResult, runHappyTGInstall } from "./install/index.js";
import type { InstallCommandOptions, InstallResult } from "./install/types.js";
import { runBootstrapCommand, type BootstrapCommand } from "./index.js";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

type CliRequest =
  | { kind: "bootstrap"; command: BootstrapCommand; json: boolean }
  | { kind: "install"; json: boolean; options: InstallCommandOptions }
  | { kind: "task-init"; json: boolean; repoRoot: string; taskId: string; sessionId: string; workspaceId: string; title: string; mode: "quick" | "proof"; acceptanceCriteria: string[] }
  | { kind: "task-validate"; json: boolean; repoRoot: string; taskId: string }
  | { kind: "task-status"; json: boolean; repoRoot: string; taskId: string };

interface TaskStatusResponse {
  task?: TaskBundle;
  rootPath: string;
  validation: {
    ok: boolean;
    missing: string[];
    canonicalOk: boolean;
    canonicalMissing: string[];
  };
}

interface ParsedOptions {
  json: boolean;
  values: Map<string, string[]>;
}

function statusBadge(status: "pass" | "warn" | "fail"): string {
  return `[${status.toUpperCase()}]`;
}

function installOutcomeSummary(outcome: InstallResult["outcome"]): string {
  switch (outcome) {
    case "success":
      return "install flow is complete.";
    case "success-with-warnings":
      return "install flow is complete with warnings.";
    case "recoverable-failure":
      return "install needs follow-up before it is fully ready.";
    case "fatal-failure":
    default:
      return "installer stopped before completion.";
  }
}

function installTelegramSummary(result: InstallResult): string {
  if (result.telegram.bot?.username) {
    return `@${result.telegram.bot.username}`;
  }

  if (!result.telegram.configured) {
    return "missing";
  }

  if (result.telegram.lookup?.status === "warning") {
    return "configured (identity lookup warning)";
  }

  if (result.telegram.lookup?.status === "failed") {
    return "configured (identity lookup failed)";
  }

  return "configured";
}

function findingLabel(severity: "info" | "warn" | "error"): string {
  return severity.toUpperCase().padEnd(5, " ");
}

function pushUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized || lines.includes(normalized)) {
    return;
  }

  lines.push(normalized);
}

function collectWarningMessages(warnings: readonly string[], automationItems: readonly AutomationItem[]): string[] {
  const messages: string[] = [];
  for (const warning of warnings) {
    pushUniqueLine(messages, warning);
  }
  for (const item of automationItems) {
    if (item.kind === "warning") {
      pushUniqueLine(messages, item.message);
    }
  }

  return messages;
}

function appendAutomationSection(lines: string[], title: string, items: readonly AutomationItem[]): void {
  if (items.length === 0) {
    return;
  }

  lines.push("");
  lines.push(`${title}:`);
  for (const item of items) {
    lines.push(...automationItemRenderLines(item));
  }
}

function appendWarningSection(lines: string[], warnings: readonly string[], warningItems: readonly AutomationItem[]): void {
  const rendered: string[] = [];
  const seen = new Set<string>();

  for (const warning of warnings) {
    const normalized = warning.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    rendered.push(`- ${normalized}`);
    seen.add(normalized);
  }

  for (const item of warningItems) {
    const normalized = item.message.trim();
    if (!normalized) {
      continue;
    }

    if (!seen.has(normalized)) {
      rendered.push(...automationItemRenderLines(item));
      seen.add(normalized);
      continue;
    }

    for (const solution of item.solutions ?? []) {
      const normalizedSolution = solution.trim();
      if (normalizedSolution) {
        rendered.push(`  - ${normalizedSolution}`);
      }
    }
  }

  if (rendered.length === 0) {
    return;
  }

  lines.push("");
  lines.push("Warnings:");
  lines.push(...rendered);
}

function appendAutomationSections(lines: string[], items: readonly AutomationItem[]): void {
  if (items.length === 0) {
    return;
  }

  const grouped = groupAutomationItems(items);
  appendAutomationSection(lines, "Auto-run", grouped.auto);
  appendAutomationSection(lines, "Requires user", grouped.manual);
  appendAutomationSection(lines, "Blocked", grouped.blocked);
  appendAutomationSection(lines, "Reuse", grouped.reuse);
  appendAutomationSection(lines, "Conflicts", grouped.conflict);
}

function summarizeFindings(result: BootstrapReport): string {
  if (result.findings.length === 0) {
    return "Environment looks ready.";
  }

  const counts = result.findings.reduce(
    (accumulator, finding) => {
      accumulator[finding.severity] += 1;
      return accumulator;
    },
    { info: 0, warn: 0, error: 0 }
  );
  const summaryParts = [
    counts.error > 0 ? `${counts.error} error${counts.error === 1 ? "" : "s"}` : "",
    counts.warn > 0 ? `${counts.warn} warning${counts.warn === 1 ? "" : "s"}` : "",
    counts.info > 0 ? `${counts.info} info` : ""
  ].filter(Boolean);

  return `${summaryParts.join(", ")} found.`;
}

function usage(): string {
  return [
    "Usage:",
    "  happytg doctor|setup|repair|verify|status [--json]",
    "  happytg install [--repo-mode clone|update|current] [--repo-dir <path>] [--repo-url <url>] [--branch <name>] [--telegram-bot-token <token>] [--allowed-user <id>]... [--home-channel <value>] [--background launchagent|scheduled-task|startup|systemd-user|manual|skip] [--post-check setup|doctor|verify]... [--non-interactive] [--json]",
    "  happytg config init [--json]",
    "  happytg env snapshot [--json]",
    "  happytg task init --repo <path> --task <TASK_ID> [--session <id>] [--workspace <id>] [--title <title>] [--mode quick|proof] [--criterion <text>]... [--json]",
    "  happytg task validate --repo <path> --task <TASK_ID> [--json]",
    "  happytg task status --repo <path> --task <TASK_ID> [--json]"
  ].join("\n");
}

function parseOptions(tokens: string[]): ParsedOptions {
  const values = new Map<string, string[]>();
  let json = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    if (key === "json") {
      json = true;
      continue;
    }

    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, [...(values.get(key) ?? []), "true"]);
      continue;
    }

    values.set(key, [...(values.get(key) ?? []), next]);
    index += 1;
  }

  return { json, values };
}

function takeOption(options: ParsedOptions, key: string, fallback?: string): string {
  return options.values.get(key)?.[0] ?? fallback ?? "";
}

function takeOptionList(options: ParsedOptions, key: string): string[] {
  return options.values.get(key) ?? [];
}

function requireOption(options: ParsedOptions, key: string): string {
  const value = takeOption(options, key);
  if (!value) {
    throw new CliUsageError(`Missing required option --${key}`);
  }

  return value;
}

export function parseHappyTGArgs(argv: string[], cwd = process.cwd()): CliRequest {
  const json = argv.includes("--json");
  const tokens = argv.filter((token) => token !== "--json");
  const [scope = "status", action, ...rest] = tokens;

  if (scope === "install") {
    const options = parseOptions(tokens.slice(1));
    const postChecks = takeOptionList(options, "post-check")
      .filter((value): value is InstallCommandOptions["postChecks"][number] => ["setup", "doctor", "verify"].includes(value));
    const background = takeOption(options, "background");
    const repoMode = takeOption(options, "repo-mode");

    return {
      kind: "install",
      json: options.json || json,
      options: {
        json: options.json || json,
        nonInteractive: options.json || json || takeOption(options, "non-interactive") === "true",
        cwd,
        launchCwd: path.resolve(cwd, takeOption(options, "launch-cwd", cwd)),
        bootstrapRepoRoot: takeOption(options, "bootstrap-repo-root") ? path.resolve(cwd, takeOption(options, "bootstrap-repo-root")) : undefined,
        repoMode: repoMode === "clone" || repoMode === "update" || repoMode === "current" ? repoMode : undefined,
        repoDir: takeOption(options, "repo-dir") ? path.resolve(cwd, takeOption(options, "repo-dir")) : undefined,
        repoUrl: takeOption(options, "repo-url") || undefined,
        branch: takeOption(options, "branch", "main"),
        dirtyWorktreeStrategy: (() => {
          const strategy = takeOption(options, "dirty-worktree");
          return strategy === "stash" || strategy === "keep" || strategy === "cancel" ? strategy : undefined;
        })(),
        telegramBotToken: takeOption(options, "telegram-bot-token") || undefined,
        telegramAllowedUserIds: [
          ...takeOptionList(options, "allowed-user"),
          ...takeOptionList(options, "allowed-user-id"),
          ...takeOptionList(options, "allowed-user-ids")
        ],
        telegramHomeChannel: takeOption(options, "home-channel") || undefined,
        backgroundMode: background === "launchagent" || background === "scheduled-task" || background === "startup" || background === "systemd-user" || background === "manual" || background === "skip"
          ? background
          : undefined,
        postChecks: postChecks.length > 0 ? postChecks : ["setup", "doctor", "verify"]
      }
    };
  }

  if (scope === "config" && action === "init") {
    return { kind: "bootstrap", command: "config-init", json };
  }

  if (scope === "env" && action === "snapshot") {
    return { kind: "bootstrap", command: "env-snapshot", json };
  }

  if (scope === "task") {
    const options = parseOptions(rest);
    const repoRoot = path.resolve(cwd, requireOption(options, "repo"));
    const taskId = requireOption(options, "task");

    if (action === "init") {
      const sessionId = takeOption(options, "session", "manual-session");
      const workspaceId = takeOption(options, "workspace", path.basename(repoRoot));
      const title = takeOption(options, "title", `Task ${taskId}`);
      const mode = takeOption(options, "mode", "proof") === "quick" ? "quick" : "proof";
      const acceptanceCriteria = takeOptionList(options, "criterion");

      return {
        kind: "task-init",
        json: options.json || json,
        repoRoot,
        taskId,
        sessionId,
        workspaceId,
        title,
        mode,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : ["Acceptance criteria not provided yet."]
      };
    }

    if (action === "validate") {
      return {
        kind: "task-validate",
        json: options.json || json,
        repoRoot,
        taskId
      };
    }

    if (action === "status") {
      return {
        kind: "task-status",
        json: options.json || json,
        repoRoot,
        taskId
      };
    }

    throw new CliUsageError(`Unsupported task action: ${action ?? "missing"}`);
  }

  const commandMap: Record<string, BootstrapCommand> = {
    doctor: "doctor",
    setup: "setup",
    repair: "repair",
    verify: "verify",
    status: "status"
  };

  if (commandMap[scope]) {
    return { kind: "bootstrap", command: commandMap[scope], json };
  }

  throw new CliUsageError(`Unsupported command: ${scope}`);
}

export function renderText(result: BootstrapReport | InstallResult | TaskBundle | TaskStatusResponse): string {
  if ("kind" in result && result.kind === "install") {
    const finalizationItems = result.finalization?.items ?? [];
    const groupedFinalization = groupAutomationItems(finalizationItems);
    const warningMessages = collectWarningMessages(result.warnings, finalizationItems);
    const lines = [
      `HappyTG install ${statusBadge(result.status)}`,
      `Result: ${installOutcomeSummary(result.outcome)}`,
      `Repo: ${result.repo.sync} ${result.repo.path}`,
      `Source: ${result.repo.source} ${result.repo.repoUrl}`,
      `Background: ${result.background.detail}`,
      `Telegram: ${installTelegramSummary(result)}`,
      `Warnings: ${warningMessages.length}`
    ];

    if (result.error) {
      lines.push(`Error: ${result.error.message}`);
      if (result.error.attempts !== undefined) {
        lines.push(`Attempts: ${result.error.attempts}`);
      }
      lines.push(`Suggested action: ${result.error.suggestedAction}`);
    }

    appendAutomationSections(lines, finalizationItems);
    appendWarningSection(lines, result.warnings, groupedFinalization.warning);

    if (finalizationItems.length === 0 && result.nextSteps.length > 0) {
      lines.push("");
      lines.push("Next steps:");
      lines.push(...result.nextSteps.map((step) => `- ${step}`));
    }

    return lines.join("\n");
  }

  if ("command" in result) {
    const onboardingItems = onboardingItemsFromReport(result);
    const groupedOnboarding = groupAutomationItems(onboardingItems);
    const preflight = Array.isArray((result.reportJson as { preflight?: unknown }).preflight)
      ? ((result.reportJson as { preflight: string[] }).preflight)
      : [];
    const lines = [
      `HappyTG ${result.command} ${statusBadge(result.status)}`,
      `Summary: ${summarizeFindings(result)}`,
      `Profile: ${result.profileRecommendation ?? "n/a"}`
    ];

    if (preflight.length > 0) {
      lines.push("");
      lines.push(result.command === "setup" ? "Preflight:" : "Checks:");
      lines.push(...preflight.map((item) => `- ${item}`));
    }

    if (result.findings.length > 0) {
      lines.push("");
      lines.push("Findings:");
      lines.push(...result.findings.map((finding) => `- ${findingLabel(finding.severity)} ${finding.message}`));
    }

    if (onboardingItems.length > 0) {
      appendAutomationSections(lines, onboardingItems);
    } else if (result.planPreview.length > 0) {
      lines.push("");
      lines.push(result.command === "setup" ? "First start:" : "Next steps:");
      lines.push(...result.planPreview.map((item) => `- ${item}`));
    }
    appendWarningSection(lines, [], groupedOnboarding.warning);

    lines.push("");
    lines.push("Diagnostics:");
    lines.push(`- Run \`pnpm happytg ${result.command} --json\` for machine-readable details.`);
    if (result.command !== "doctor") {
      lines.push("- Run `pnpm happytg doctor --json` for the full environment report.");
    }

    return lines.join("\n");
  }

  if ("phase" in result) {
    const lines = [
      `Task: ${result.id}`,
      `Mode: ${result.mode}`,
      `Phase: ${result.phase}`,
      `Verification: ${result.verificationState}`,
      `Bundle: ${result.rootPath}`
    ];
    return lines.join("\n");
  }

  if ("validation" in result) {
    return [
      `Task: ${result.task?.id ?? path.basename(result.rootPath)}`,
      `Bundle: ${result.rootPath}`,
      `Validation: ${result.validation.ok ? "ok" : `missing ${result.validation.missing.join(", ")}`}`,
      `Phase: ${result.task?.phase ?? "unknown"}`,
      `Verification: ${result.task?.verificationState ?? "unknown"}`
    ].join("\n");
  }

  return "Unsupported result";
}

export async function executeHappyTG(
  argv: string[],
  cwd = process.cwd(),
  runtime?: {
    runBootstrapCommandImpl?: typeof runBootstrapCommand;
    runHappyTGInstallImpl?: typeof runHappyTGInstall;
  }
): Promise<BootstrapReport | InstallResult | TaskBundle | TaskStatusResponse> {
  const request = parseHappyTGArgs(argv, cwd);
  const runBootstrapCommandImpl = runtime?.runBootstrapCommandImpl ?? runBootstrapCommand;
  const runHappyTGInstallImpl = runtime?.runHappyTGInstallImpl ?? runHappyTGInstall;

  switch (request.kind) {
    case "bootstrap":
      return runBootstrapCommandImpl(request.command);
    case "install":
      try {
        return await runHappyTGInstallImpl(request.options, {
          runBootstrapCheck: runBootstrapCommandImpl
        });
      } catch (error) {
        return createInstallFailureResult({
          options: request.options,
          error
        });
      }
    case "task-init":
      return initTaskBundle({
        repoRoot: request.repoRoot,
        taskId: request.taskId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        title: request.title,
        mode: request.mode,
        acceptanceCriteria: request.acceptanceCriteria
      });
    case "task-validate": {
      const rootPath = taskBundlePath(request.repoRoot, request.taskId);
      return {
        rootPath,
        task: await readTaskBundle(rootPath),
        validation: await validateTaskBundle(rootPath)
      };
    }
    case "task-status": {
      const rootPath = taskBundlePath(request.repoRoot, request.taskId);
      return {
        rootPath,
        task: await readTaskBundle(rootPath),
        validation: await validateTaskBundle(rootPath)
      };
    }
  }
}

async function main(argv: string[]): Promise<void> {
  loadHappyTGEnv();

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const request = parseHappyTGArgs(argv);
  const result = await executeHappyTG(argv);
  if (request.json) {
    console.log(JSON.stringify(result, null, 2));
    if ("kind" in result && result.kind === "install" && result.status === "fail") {
      process.exitCode = 1;
    }
    return;
  }

  if ("kind" in result && result.kind === "install" && result.tuiHandled) {
    if (result.status === "fail") {
      process.exitCode = 1;
    }
    return;
  }

  console.log(renderText(result));
  if ("kind" in result && result.kind === "install" && result.status === "fail") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "HappyTG CLI failed");
    if (error instanceof CliUsageError) {
      console.error(usage());
    }
    process.exitCode = 1;
  });
}
