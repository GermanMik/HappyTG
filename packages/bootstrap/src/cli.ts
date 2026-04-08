#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BootstrapReport, TaskBundle } from "../../protocol/src/index.js";
import { initTaskBundle, readTaskBundle, taskBundlePath, validateTaskBundle } from "../../repo-proof/src/index.js";

import { runBootstrapCommand, type BootstrapCommand } from "./index.js";

type CliRequest =
  | { kind: "bootstrap"; command: BootstrapCommand; json: boolean }
  | { kind: "task-init"; json: boolean; repoRoot: string; taskId: string; sessionId: string; workspaceId: string; title: string; mode: "quick" | "proof"; acceptanceCriteria: string[] }
  | { kind: "task-validate"; json: boolean; repoRoot: string; taskId: string }
  | { kind: "task-status"; json: boolean; repoRoot: string; taskId: string };

interface TaskStatusResponse {
  task?: TaskBundle;
  rootPath: string;
  validation: {
    ok: boolean;
    missing: string[];
  };
}

interface ParsedOptions {
  json: boolean;
  values: Map<string, string[]>;
}

function statusBadge(status: "pass" | "warn" | "fail"): string {
  return `[${status.toUpperCase()}]`;
}

function findingLabel(severity: "info" | "warn" | "error"): string {
  return severity.toUpperCase().padEnd(5, " ");
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
    throw new Error(`Missing required option --${key}`);
  }

  return value;
}

export function parseHappyTGArgs(argv: string[], cwd = process.cwd()): CliRequest {
  const json = argv.includes("--json");
  const tokens = argv.filter((token) => token !== "--json");
  const [scope = "status", action, ...rest] = tokens;

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

    throw new Error(`Unsupported task action: ${action ?? "missing"}`);
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

  throw new Error(`Unsupported command: ${scope}`);
}

export function renderText(result: BootstrapReport | TaskBundle | TaskStatusResponse): string {
  if ("command" in result) {
    const lines = [
      `HappyTG ${result.command} ${statusBadge(result.status)}`,
      `Summary: ${summarizeFindings(result)}`,
      `Profile: ${result.profileRecommendation ?? "n/a"}`
    ];

    if (result.findings.length > 0) {
      lines.push("");
      lines.push("Findings:");
      lines.push(...result.findings.map((finding) => `- ${findingLabel(finding.severity)} ${finding.message}`));
    }

    if (result.planPreview.length > 0) {
      lines.push("");
      lines.push("Next steps:");
      lines.push(...result.planPreview.map((item) => `- ${item}`));
    }

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

  return [
    `Task: ${result.task?.id ?? path.basename(result.rootPath)}`,
    `Bundle: ${result.rootPath}`,
    `Validation: ${result.validation.ok ? "ok" : `missing ${result.validation.missing.join(", ")}`}`,
    `Phase: ${result.task?.phase ?? "unknown"}`,
    `Verification: ${result.task?.verificationState ?? "unknown"}`
  ].join("\n");
}

export async function executeHappyTG(argv: string[], cwd = process.cwd()): Promise<BootstrapReport | TaskBundle | TaskStatusResponse> {
  const request = parseHappyTGArgs(argv, cwd);

  switch (request.kind) {
    case "bootstrap":
      return runBootstrapCommand(request.command);
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
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const request = parseHappyTGArgs(argv);
  const result = await executeHappyTG(argv);
  if (request.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderText(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "HappyTG CLI failed");
    console.error(usage());
    process.exitCode = 1;
  });
}
