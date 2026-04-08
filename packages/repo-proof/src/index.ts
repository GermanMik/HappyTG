import path from "node:path";

import type { EvidenceArtifact, TaskBundle, TaskPhase, VerificationRun, VerificationState } from "../../protocol/src/index.js";
import { createId, ensureDir, fileExists, nowIso, readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from "../../shared/src/index.js";

const REQUIRED_FILES = [
  "spec.md",
  "evidence.md",
  "evidence.json",
  "verdict.json",
  "problems.md",
  path.join("raw", "build.txt"),
  path.join("raw", "test-unit.txt"),
  path.join("raw", "test-integration.txt"),
  path.join("raw", "lint.txt")
] as const;

export const TASK_METADATA_FILE = "task.json";

export function taskBundlePath(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, ".agent", "tasks", taskId);
}

async function writeTaskMetadata(task: TaskBundle): Promise<void> {
  await writeJsonFileAtomic(path.join(task.rootPath, TASK_METADATA_FILE), task);
}

export async function readTaskBundle(rootPath: string): Promise<TaskBundle | undefined> {
  const metadataPath = path.join(rootPath, TASK_METADATA_FILE);
  if (!(await fileExists(metadataPath))) {
    return undefined;
  }

  return readJsonFile<TaskBundle | undefined>(metadataPath, undefined);
}

export async function initTaskBundle(input: {
  repoRoot: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  title: string;
  acceptanceCriteria: string[];
  mode: "quick" | "proof";
}): Promise<TaskBundle> {
  const rootPath = taskBundlePath(input.repoRoot, input.taskId);
  await ensureDir(path.join(rootPath, "raw"));
  const createdAt = nowIso();
  const task: TaskBundle = {
    id: input.taskId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    rootPath,
    phase: input.mode === "proof" ? "init" : "complete",
    mode: input.mode,
    title: input.title,
    acceptanceCriteria: input.acceptanceCriteria,
    verificationState: input.mode === "proof" ? "not_started" : "passed",
    createdAt,
    updatedAt: createdAt
  };

  const specContent = [
    "# Task Spec",
    "",
    `- Task ID: ${input.taskId}`,
    `- Title: ${input.title}`,
    "- Owner: HappyTG",
    `- Mode: ${input.mode}`,
    "- Status: initialized",
    "",
    "## Problem",
    "",
    "Describe the problem before build begins.",
    "",
    "## Acceptance Criteria",
    "",
    ...input.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    "",
    "## Constraints",
    "",
    "- Runtime: Codex CLI",
    "- Verification: fresh verifier required",
    "- Out of scope: undefined",
    "",
    "## Verification Plan",
    "",
    "- Unit: define before verify",
    "- Integration: define before verify",
    "- Manual: define before verify",
    ""
  ].join("\n");

  await Promise.all([
    writeTextFileAtomic(path.join(rootPath, "spec.md"), specContent),
    writeTextFileAtomic(path.join(rootPath, "evidence.md"), "# Evidence Summary\n\n## Acceptance Criteria Mapping\n\n"),
    writeJsonFileAtomic(path.join(rootPath, "evidence.json"), {
      taskId: input.taskId,
      criteria: input.acceptanceCriteria.map((criterion) => ({
        criterion,
        artifacts: []
      })),
      artifacts: [],
      generatedAt: createdAt
    }),
    writeJsonFileAtomic(path.join(rootPath, "verdict.json"), {
      taskId: input.taskId,
      status: "pending",
      verifier: {
        role: "task-verifier",
        runId: ""
      },
      checks: [],
      generatedAt: createdAt
    }),
    writeTextFileAtomic(path.join(rootPath, "problems.md"), "# Verification Findings\n\n## Findings\n\n- No findings recorded yet.\n"),
    writeTextFileAtomic(path.join(rootPath, "raw", "build.txt"), ""),
    writeTextFileAtomic(path.join(rootPath, "raw", "test-unit.txt"), ""),
    writeTextFileAtomic(path.join(rootPath, "raw", "test-integration.txt"), ""),
    writeTextFileAtomic(path.join(rootPath, "raw", "lint.txt"), ""),
    writeTaskMetadata(task)
  ]);

  return task;
}

export async function freezeTaskSpec(task: TaskBundle, details: {
  owner?: string;
  problem: string;
  verificationPlan: string[];
  constraints?: string[];
}): Promise<TaskBundle> {
  const lines = [
    "# Task Spec",
    "",
    `- Task ID: ${task.id}`,
    `- Title: ${task.title}`,
    `- Owner: ${details.owner ?? "HappyTG"}`,
    `- Mode: ${task.mode}`,
    "- Status: frozen",
    "",
    "## Problem",
    "",
    details.problem,
    "",
    "## Acceptance Criteria",
    "",
    ...task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    "",
    "## Constraints",
    "",
    ...(details.constraints ?? ["- Runtime: Codex CLI", "- Verifier must be independent"]),
    "",
    "## Verification Plan",
    "",
    ...details.verificationPlan.map((line) => `- ${line}`),
    ""
  ];

  await writeTextFileAtomic(path.join(task.rootPath, "spec.md"), `${lines.join("\n")}\n`);

  const updatedTask: TaskBundle = {
    ...task,
    phase: "spec_frozen",
    updatedAt: nowIso()
  };
  await writeTaskMetadata(updatedTask);
  return updatedTask;
}

export async function writeRawArtifact(task: TaskBundle, name: string, content: string): Promise<EvidenceArtifact> {
  const artifactPath = path.join(task.rootPath, "raw", name);
  await writeTextFileAtomic(artifactPath, content);
  return {
    id: createId("art"),
    taskId: task.id,
    kind: "raw",
    path: artifactPath,
    storageKind: "repo-local",
    createdAt: nowIso()
  };
}

export async function updateEvidence(task: TaskBundle, summary: string, artifacts: string[]): Promise<TaskBundle> {
  await writeTextFileAtomic(
    path.join(task.rootPath, "evidence.md"),
    `# Evidence Summary\n\n## Acceptance Criteria Mapping\n\n${summary}\n\n## Artifacts\n\n${artifacts.map((item) => `- ${item}`).join("\n")}\n`
  );
  await writeJsonFileAtomic(path.join(task.rootPath, "evidence.json"), {
    taskId: task.id,
    criteria: task.acceptanceCriteria.map((criterion) => ({
      criterion,
      artifacts
    })),
    artifacts,
    generatedAt: nowIso()
  });

  const updatedTask: TaskBundle = {
    ...task,
    phase: "evidence",
    updatedAt: nowIso()
  };
  await writeTaskMetadata(updatedTask);
  return updatedTask;
}

export async function writeVerificationVerdict(input: {
  task: TaskBundle;
  runId: string;
  status: VerificationState;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  findings: string[];
  summary: string;
}): Promise<{ task: TaskBundle; verificationRun: VerificationRun }> {
  const now = nowIso();
  await writeJsonFileAtomic(path.join(input.task.rootPath, "verdict.json"), {
    taskId: input.task.id,
    status: input.status,
    verifier: {
      role: "task-verifier",
      runId: input.runId
    },
    checks: input.checks,
    generatedAt: now
  });

  await writeTextFileAtomic(
    path.join(input.task.rootPath, "problems.md"),
    `# Verification Findings\n\n## Findings\n\n${input.findings.length > 0 ? input.findings.map((finding) => `- ${finding}`).join("\n") : "- No findings."}\n\n## Summary\n\n${input.summary}\n`
  );

  const phase: TaskPhase = input.status === "passed" ? "complete" : "fix";
  const updatedTask: TaskBundle = {
    ...input.task,
    phase,
    verificationState: input.status,
    updatedAt: now
  };
  await writeTaskMetadata(updatedTask);
  return {
    task: updatedTask,
    verificationRun: {
      id: input.runId,
      taskId: input.task.id,
      sessionId: input.task.sessionId,
      status: input.status,
      startedAt: now,
      finishedAt: now,
      summary: input.summary
    }
  };
}

export async function validateTaskBundle(rootPath: string): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  await Promise.all(
    REQUIRED_FILES.map(async (relativePath) => {
      const fullPath = path.join(rootPath, relativePath);
      const exists = await fileExists(fullPath);
      if (!exists) {
        missing.push(relativePath);
      }
    })
  );

  return {
    ok: missing.length === 0,
    missing
  };
}
