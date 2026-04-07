import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BootstrapFinding, BootstrapReport } from "../../protocol/src/index.js";
import { checkCodexReadiness } from "../../runtime-adapters/src/index.js";
import { createId, ensureDir, fileExists, getLocalStateDir, nowIso, writeJsonFileAtomic } from "../../shared/src/index.js";

type BootstrapCommand = "doctor" | "setup" | "repair" | "verify" | "status" | "config-init" | "env-snapshot";

interface DoctorContext {
  command: BootstrapCommand;
}

export interface DoctorDetection {
  findings: BootstrapFinding[];
  planPreview: string[];
  profileRecommendation: BootstrapReport["profileRecommendation"];
  reportJson: Record<string, unknown>;
}

export async function detectFindings(): Promise<DoctorDetection> {
  const findings: BootstrapFinding[] = [];
  const planPreview: string[] = [];

  const platform = `${os.platform()}-${os.arch()}`;
  const hasGit = await fileExists("/usr/bin/git").catch(() => false);
  const codex = await checkCodexReadiness();

  if (!hasGit) {
    findings.push({
      code: "GIT_MISSING",
      severity: "warn",
      message: "Git binary was not detected at /usr/bin/git. PATH-based detection should be added next."
    });
    planPreview.push("Verify Git is installed and visible in PATH");
  }

  if (!codex.available) {
    findings.push({
      code: "CODEX_MISSING",
      severity: "error",
      message: "Codex CLI was not found or failed to run"
    });
    planPreview.push("Install Codex CLI globally with npm");
  }

  if (!codex.configExists) {
    findings.push({
      code: "CODEX_CONFIG_MISSING",
      severity: "warn",
      message: `Codex config was not found at ${codex.configPath}`
    });
    planPreview.push("Initialize ~/.codex/config.toml");
  }

  if (codex.available && codex.configExists && !codex.smokeOk) {
    findings.push({
      code: "CODEX_SMOKE_FAILED",
      severity: "warn",
      message: codex.smokeError || "Codex smoke check failed"
    });
    planPreview.push("Review Codex auth and runtime configuration");
  }

  if (codex.smokeError) {
    findings.push({
      code: "CODEX_SMOKE_WARNINGS",
      severity: "warn",
      message: codex.smokeError.split("\n").slice(0, 3).join(" ").trim()
    });
    planPreview.push("Inspect Codex stderr warnings reported during smoke check");
  }

  const profileRecommendation = findings.some((item) => item.severity === "error") ? "minimal" : "recommended";

  return {
    findings,
    planPreview,
    profileRecommendation,
    reportJson: {
      platform,
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

async function main(command: BootstrapCommand): Promise<void> {
  const report = await runBootstrapCommand(command);
  console.log(JSON.stringify(report, null, 2));
}

const rawCommand = (process.argv[2] ?? "status").toLowerCase();
const commandMap: Record<string, BootstrapCommand> = {
  doctor: "doctor",
  setup: "setup",
  repair: "repair",
  verify: "verify",
  status: "status",
  "config-init": "config-init",
  config: "config-init",
  env: "env-snapshot",
  "env-snapshot": "env-snapshot"
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main(commandMap[rawCommand] ?? "status");
}
