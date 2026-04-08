import os from "node:os";
import path from "node:path";

import type { BootstrapFinding, BootstrapReport } from "../../protocol/src/index.js";
import { checkCodexReadiness, codexCliMissingMessage } from "../../runtime-adapters/src/index.js";
import { createId, ensureDir, getLocalStateDir, nowIso, resolveExecutable, writeJsonFileAtomic } from "../../shared/src/index.js";

export type BootstrapCommand = "doctor" | "setup" | "repair" | "verify" | "status" | "config-init" | "env-snapshot";

interface DoctorContext {
  command: BootstrapCommand;
}

export interface DoctorDetection {
  findings: BootstrapFinding[];
  planPreview: string[];
  profileRecommendation: BootstrapReport["profileRecommendation"];
  reportJson: Record<string, unknown>;
}

function pushPlanStep(planPreview: string[], step: string): void {
  if (!planPreview.includes(step)) {
    planPreview.push(step);
  }
}

export async function detectFindings(): Promise<DoctorDetection> {
  const findings: BootstrapFinding[] = [];
  const planPreview: string[] = [];

  const platform = `${os.platform()}-${os.arch()}`;
  const gitBinaryPath = await resolveExecutable("git");
  const hasGit = Boolean(gitBinaryPath);
  const codex = await checkCodexReadiness();

  if (!hasGit) {
    findings.push({
      code: "GIT_MISSING",
      severity: "warn",
      message: "Git was not found in PATH. Install Git, verify `git --version`, then rerun `pnpm happytg doctor`."
    });
    pushPlanStep(planPreview, "Install Git and verify `git --version`.");
  }

  if (!codex.available) {
    findings.push({
      code: "CODEX_MISSING",
      severity: "error",
      message: codexCliMissingMessage()
    });
    pushPlanStep(planPreview, "Install Codex CLI and verify `codex --version`.");
  }

  if (!codex.configExists) {
    findings.push({
      code: "CODEX_CONFIG_MISSING",
      severity: "warn",
      message: "Codex config was not found. Create `~/.codex/config.toml`, then rerun `pnpm happytg doctor`."
    });
    pushPlanStep(planPreview, "Create `~/.codex/config.toml`, then rerun `pnpm happytg doctor`.");
  }

  if (codex.available && codex.configExists && !codex.smokeOk) {
    findings.push({
      code: "CODEX_SMOKE_FAILED",
      severity: "warn",
      message: "Codex CLI started, but the smoke check did not complete. Review Codex auth/config, then rerun `pnpm happytg doctor --json`."
    });
    pushPlanStep(planPreview, "Review Codex auth/config and rerun `pnpm happytg doctor --json`.");
  }

  if (codex.available && codex.configExists && codex.smokeOk && codex.smokeError) {
    findings.push({
      code: "CODEX_SMOKE_WARNINGS",
      severity: "warn",
      message: "Codex CLI completed the smoke check with warnings. Run `pnpm happytg doctor --json` for the detailed stderr output."
    });
    pushPlanStep(planPreview, "Inspect Codex warnings with `pnpm happytg doctor --json`.");
  }

  const profileRecommendation = findings.some((item) => item.severity === "error") ? "minimal" : "recommended";

  return {
    findings,
    planPreview,
    profileRecommendation,
    reportJson: {
      platform,
      git: {
        available: hasGit,
        binaryPath: gitBinaryPath ?? null
      },
      codex
    }
  };
}

async function writeReport(command: BootstrapCommand, report: Omit<BootstrapReport, "id" | "command" | "createdAt">): Promise<BootstrapReport> {
  const createdAt = nowIso();
  const completeReport: BootstrapReport = {
    id: createId("btr"),
    command,
    createdAt,
    ...report
  };

  const stateDir = path.join(getLocalStateDir(), "state");
  await ensureDir(stateDir);
  const fileMap: Record<BootstrapCommand, string> = {
    doctor: "doctor-last.json",
    setup: "setup-last.json",
    repair: "repair-last.json",
    verify: "verify-last.json",
    status: "status-last.json",
    "config-init": "config-init-last.json",
    "env-snapshot": "env-snapshot-last.json"
  };

  await writeJsonFileAtomic(path.join(stateDir, fileMap[command]), completeReport);
  return completeReport;
}

export async function runDoctorLike(command: BootstrapCommand): Promise<BootstrapReport> {
  const detected = await detectFindings();
  const status: BootstrapReport["status"] = detected.findings.some((item) => item.severity === "error")
    ? "fail"
    : detected.findings.length > 0
      ? "warn"
      : "pass";

  return writeReport(command, {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status,
    profileRecommendation: detected.profileRecommendation,
    findings: detected.findings,
    planPreview: detected.planPreview,
    reportJson: detected.reportJson
  });
}

export async function runConfigInit(): Promise<BootstrapReport> {
  const codexConfigPath = path.join(getLocalStateDir().replace(/\.happytg$/, ".codex"), "config.toml");
  return writeReport("config-init", {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status: "warn",
    profileRecommendation: "minimal",
    findings: [
      {
        code: "CONFIG_INIT_PLAN_ONLY",
        severity: "info",
        message: `Config init is plan-only for now. Target path would be ${codexConfigPath}.`
      }
    ],
    planPreview: [
      "Create ~/.codex/config.toml if missing",
      "Backup existing config before edits"
    ],
    reportJson: {
      targetPath: codexConfigPath
    }
  });
}

export async function runEnvSnapshot(): Promise<BootstrapReport> {
  return writeReport("env-snapshot", {
    hostFingerprint: `${os.hostname()}-${os.platform()}-${os.arch()}`,
    status: "pass",
    profileRecommendation: "recommended",
    findings: [],
    planPreview: [],
    reportJson: {
      platform: os.platform(),
      arch: os.arch(),
      cwd: process.cwd(),
      node: process.version,
      shell: process.env.SHELL ?? null
    }
  });
}

export async function runBootstrapCommand(command: BootstrapCommand): Promise<BootstrapReport> {
  switch (command) {
    case "doctor":
    case "setup":
    case "repair":
    case "verify":
    case "status":
      return runDoctorLike(command);
    case "config-init":
      return runConfigInit();
    case "env-snapshot":
      return runEnvSnapshot();
    default:
      return runDoctorLike("status");
  }
}
