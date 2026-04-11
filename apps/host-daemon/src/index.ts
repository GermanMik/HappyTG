import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBootstrapCommand } from "../../../packages/bootstrap/src/index.js";
import { freezeTaskSpec, updateEvidence, writeRawArtifact, writeVerificationVerdict } from "../../../packages/repo-proof/src/index.js";
import { checkCodexReadiness, codexCliMissingMessage, runCodexExec } from "../../../packages/runtime-adapters/src/index.js";
import type {
  DaemonCompleteRequest,
  DaemonDispatchAckRequest,
  DaemonTaskPhaseRequest,
  HostHelloResponse,
  LocalJournalEntry,
  PendingDispatch,
  RuntimeExecutionResult,
  TaskBundle
} from "../../../packages/protocol/src/index.js";
import {
  createLogger,
  ensureDir,
  getLocalStateDir,
  loadHappyTGEnv,
  nowIso,
  readJsonFile,
  writeJsonFileAtomic
} from "../../../packages/shared/src/index.js";

loadHappyTGEnv();
const logger = createLogger("host-daemon");
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const heartbeatMs = Number(process.env.HOST_DAEMON_DEFAULT_POLL_MS ?? 2_000);
const journalRetentionMs = Number(process.env.HOST_DAEMON_JOURNAL_RETENTION_MS ?? 86_400_000);
const startupNoticeSuppressMs = Number(process.env.HOST_DAEMON_REPEAT_SUPPRESS_MS ?? 60_000);
const stateDir = getLocalStateDir();
const stateFile = path.join(stateDir, "daemon-state.json");
const journalFile = path.join(stateDir, "daemon-journal.json");
const startupNotices = new Map<string, number>();

type SandboxMode = "read-only" | "workspace-write";

interface DaemonWorkspace {
  id?: string;
  path: string;
  repoName: string;
  defaultBranch?: string;
}

interface DaemonState {
  hostId?: string;
  hostLabel: string;
  fingerprint: string;
  apiBaseUrl: string;
  workspaces: DaemonWorkspace[];
  lastHelloAt?: string;
}

interface DaemonJournal {
  entries: LocalJournalEntry[];
}

export function defaultFingerprint(): string {
  return `${os.hostname()}-${os.platform()}-${os.arch()}`;
}

export function defaultWorkspaces(env = process.env, cwd = process.cwd()): DaemonWorkspace[] {
  const configured = env.HAPPYTG_WORKSPACES?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const paths = configured.length > 0 ? configured : [cwd];
  return paths.map((workspacePath) => ({
    path: workspacePath,
    repoName: path.basename(workspacePath)
  }));
}

export function configuredBotTarget(env = process.env): string | undefined {
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "");
  return username ? `@${username}` : undefined;
}

export function hostNotPairedMessage(env = process.env): string {
  const target = configuredBotTarget(env);
  return target
    ? `Host is not paired yet. Run \`pnpm daemon:pair\`, then send the code to ${target} with \`/pair <CODE>\`.`
    : "Host is not paired yet. Run `pnpm daemon:pair`, then send the code in Telegram with `/pair <CODE>`.";
}

export function pairingInstructions(pairingCode: string, env = process.env): string[] {
  const target = configuredBotTarget(env);
  return [
    target
      ? `Pair with ${target} using: /pair ${pairingCode}`
      : `Pair with Telegram using: /pair ${pairingCode}`,
    target
      ? `Next: keep \`pnpm dev\` running, send the command to ${target}, then start the daemon with \`pnpm dev:daemon\`.`
      : "Next: keep `pnpm dev` running, send the command in Telegram, then start the daemon with `pnpm dev:daemon`."
  ];
}

export function startupReadinessMessage(input: { available: boolean; missing?: boolean }): string | undefined {
  if (!input.available && input.missing !== false) {
    return codexCliMissingMessage();
  }

  return undefined;
}

export function firstRunGuidance(input: { hostId?: string; readinessAvailable: boolean; readinessMissing?: boolean }): string | undefined {
  if (!input.readinessAvailable && input.readinessMissing !== false) {
    return codexCliMissingMessage();
  }

  if (!input.hostId) {
    return hostNotPairedMessage();
  }

  return undefined;
}

export function shouldEmitStartupNotice(
  noticeCache: Map<string, number>,
  key: string,
  nowMs = Date.now(),
  suppressMs = startupNoticeSuppressMs
): boolean {
  const lastEmittedAt = noticeCache.get(key);
  if (lastEmittedAt !== undefined && nowMs - lastEmittedAt < suppressMs) {
    return false;
  }

  noticeCache.set(key, nowMs);
  return true;
}

function clearStartupNotice(key: string): void {
  startupNotices.delete(key);
}

function emitStartupNotice(key: string, message: string): void {
  if (shouldEmitStartupNotice(startupNotices, key)) {
    console.log(message);
  }
}

async function loadState(): Promise<DaemonState> {
  return readJsonFile<DaemonState>(stateFile, {
    hostLabel: process.env.HAPPYTG_HOST_LABEL ?? os.hostname(),
    fingerprint: process.env.HAPPYTG_HOST_FINGERPRINT ?? defaultFingerprint(),
    apiBaseUrl,
    workspaces: defaultWorkspaces()
  });
}

async function saveState(state: DaemonState): Promise<void> {
  await ensureDir(stateDir);
  await writeJsonFileAtomic(stateFile, state);
}

async function loadJournal(): Promise<DaemonJournal> {
  return readJsonFile<DaemonJournal>(journalFile, { entries: [] });
}

async function saveJournal(journal: DaemonJournal): Promise<void> {
  await ensureDir(stateDir);
  await writeJsonFileAtomic(journalFile, journal);
}

export function compactJournal(
  journal: DaemonJournal,
  options?: {
    nowMs?: number;
    retentionMs?: number;
  }
): DaemonJournal {
  const now = options?.nowMs ?? Date.now();
  const retentionMs = options?.retentionMs ?? journalRetentionMs;
  return {
    entries: journal.entries.filter((entry) => {
      if (entry.state !== "completed" && entry.state !== "failed") {
        return true;
      }

      return now - new Date(entry.lastUpdatedAt).getTime() <= retentionMs;
    })
  };
}

async function apiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, apiBaseUrl), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${pathname} failed with ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

export function sandboxForDispatch(dispatch: PendingDispatch): SandboxMode {
  switch (dispatch.actionKind) {
    case "workspace_read":
    case "read_status":
    case "verification_run":
      return "read-only";
    default:
      return "workspace-write";
  }
}

async function pairHost(labelOverride?: string): Promise<void> {
  const state = await loadState();
  if (labelOverride) {
    state.hostLabel = labelOverride;
  }

  const response = await apiFetch<{ hostId: string; pairingCode: string; expiresAt: string }>("/api/v1/pairing/start", {
    method: "POST",
    body: JSON.stringify({
      hostLabel: state.hostLabel,
      fingerprint: state.fingerprint
    })
  });

  state.hostId = response.hostId;
  await saveState(state);

  logger.info("Pairing code issued", response);
  for (const line of pairingInstructions(response.pairingCode)) {
    console.log(line);
  }
  console.log(`Host ID: ${response.hostId}`);
  console.log(`Expires at: ${response.expiresAt}`);
}

async function hello(state: DaemonState): Promise<{ state: DaemonState; dispatches: PendingDispatch[] }> {
  if (!state.hostId) {
    throw new Error(hostNotPairedMessage());
  }

  const response = await apiFetch<HostHelloResponse>("/api/v1/daemon/hello", {
    method: "POST",
    body: JSON.stringify({
      hostId: state.hostId,
      fingerprint: state.fingerprint,
      capabilities: ["codex-cli", "proof-loop", "resume"],
      workspaces: state.workspaces
    })
  });

  state.lastHelloAt = nowIso();
  state.workspaces = response.workspaces.map((workspace) => ({
    id: workspace.id,
    path: workspace.path,
    repoName: workspace.repoName,
    defaultBranch: workspace.defaultBranch
  }));
  await saveState(state);

  return {
    state,
    dispatches: response.pendingDispatches
  };
}

async function heartbeat(hostId: string): Promise<void> {
  await apiFetch("/api/v1/daemon/heartbeat", {
    method: "POST",
    body: JSON.stringify({ hostId })
  });
}

async function poll(hostId: string): Promise<PendingDispatch[]> {
  const response = await apiFetch<{ dispatches: PendingDispatch[] }>("/api/v1/daemon/poll", {
    method: "POST",
    body: JSON.stringify({ hostId })
  });

  return response.dispatches;
}

async function ackDispatch(dispatch: PendingDispatch, hostId: string): Promise<void> {
  const payload: DaemonDispatchAckRequest = {
    hostId,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    idempotencyKey: dispatch.idempotencyKey
  };
  await apiFetch("/api/v1/daemon/dispatch/ack", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function updateSessionEvent(hostId: string, sessionId: string, summary?: string, state?: "running" | "verifying" | "completed" | "failed"): Promise<void> {
  await apiFetch("/api/v1/daemon/session/event", {
    method: "POST",
    body: JSON.stringify({
      hostId,
      sessionId,
      summary,
      state
    })
  });
}

async function updateTaskPhase(hostId: string, taskId: string, phase: DaemonTaskPhaseRequest["phase"], verificationState?: DaemonTaskPhaseRequest["verificationState"]): Promise<void> {
  await apiFetch("/api/v1/daemon/task/phase", {
    method: "POST",
    body: JSON.stringify({
      hostId,
      taskId,
      phase,
      verificationState
    })
  });
}

async function completeDispatch(hostId: string, payload: DaemonCompleteRequest): Promise<void> {
  await apiFetch("/api/v1/daemon/session/complete", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function loadTask(taskId: string): Promise<TaskBundle> {
  const response = await apiFetch<{ task: TaskBundle }>(`/api/v1/tasks/${taskId}`);
  return response.task;
}

function proofBuilderPrompt(task: TaskBundle, dispatch: PendingDispatch, workspacePath: string): string {
  return [
    "You are task-builder for HappyTG.",
    `Read the frozen spec at ${path.join(task.rootPath, "spec.md")}.`,
    `Work in repository ${workspacePath}.`,
    "Implement only the frozen scope. Keep changes minimal and production-oriented.",
    "Do not self-certify completion. Summarize changed files and verification commands run.",
    `Original task prompt: ${dispatch.prompt}`
  ].join("\n");
}

function proofVerifierPrompt(task: TaskBundle, workspacePath: string): string {
  return [
    "You are task-verifier for HappyTG.",
    `Inspect repository ${workspacePath}.`,
    `Read ${path.join(task.rootPath, "spec.md")}, evidence.md, problems.md, and raw artifacts.`,
    "Do not modify any files.",
    "Your final message must start with exactly one of:",
    "VERDICT: PASS",
    "VERDICT: FAIL",
    "Then give a short justification and bullet findings if any."
  ].join("\n");
}

function proofFixerPrompt(task: TaskBundle, workspacePath: string): string {
  return [
    "You are task-fixer for HappyTG.",
    `Work in repository ${workspacePath}.`,
    `Read ${path.join(task.rootPath, "spec.md")} and ${path.join(task.rootPath, "problems.md")}.`,
    "Apply the minimum code change needed to address the verifier findings.",
    "Do not broaden scope and do not claim verification."
  ].join("\n");
}

export function parseVerifierVerdict(summary: string): "passed" | "failed" {
  const firstLine = summary.split("\n")[0]?.trim().toUpperCase() ?? "";
  return firstLine.includes("PASS") ? "passed" : "failed";
}

export function summarizeBootstrapReport(report: Awaited<ReturnType<typeof runBootstrapCommand>>): string {
  if (report.findings.length === 0) {
    return `Bootstrap ${report.command} ${report.status}: no findings.`;
  }

  return `Bootstrap ${report.command} ${report.status}: ${report.findings.slice(0, 3).map((item) => item.code).join(", ")}`;
}

async function processBootstrapDispatch(state: DaemonState, dispatch: PendingDispatch): Promise<DaemonCompleteRequest> {
  const command = dispatch.executionKind === "bootstrap_doctor" ? "doctor" : "verify";
  await updateSessionEvent(state.hostId!, dispatch.sessionId, `Bootstrap ${command} running on ${state.hostLabel}`, "running");
  const report = await runBootstrapCommand(command);

  return {
    hostId: state.hostId!,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    ok: report.status !== "fail",
    summary: summarizeBootstrapReport(report),
    stdoutArtifactPath: path.join(stateDir, "state", `${command}-last.json`)
  };
}

async function processQuickDispatch(state: DaemonState, dispatch: PendingDispatch, workspace: DaemonWorkspace): Promise<DaemonCompleteRequest> {
  const sandbox = sandboxForDispatch(dispatch);
  await updateSessionEvent(state.hostId!, dispatch.sessionId, `Quick task running in ${workspace.repoName}`, "running");

  const result = await runCodexExec({
    cwd: workspace.path,
    prompt: dispatch.prompt,
    sandbox
  });

  return {
    hostId: state.hostId!,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    ok: result.ok,
    summary: result.summary
  };
}

async function runVerifier(task: TaskBundle, workspace: DaemonWorkspace, rawArtifactName: string): Promise<RuntimeExecutionResult> {
  const result = await runCodexExec({
    cwd: workspace.path,
    prompt: proofVerifierPrompt(task, workspace.path),
    sandbox: "read-only"
  });
  await writeRawArtifact(task, rawArtifactName, `${result.stdout}\n\n--- STDERR ---\n\n${result.stderr}`.trim());
  return result;
}

async function processProofDispatch(state: DaemonState, dispatch: PendingDispatch, workspace: DaemonWorkspace): Promise<DaemonCompleteRequest> {
  if (!dispatch.taskId) {
    throw new Error("Proof dispatch is missing taskId");
  }

  let task = await loadTask(dispatch.taskId);
  task = await freezeTaskSpec(task, {
    problem: dispatch.prompt,
    verificationPlan: [
      "Run builder Codex session with workspace-write sandbox",
      "Collect build.txt and verifier raw outputs",
      "Run fresh verifier in read-only sandbox",
      "If verifier fails, run minimal fixer and fresh verifier again"
    ]
  });
  await updateTaskPhase(state.hostId!, task.id, task.phase, task.verificationState);
  await updateSessionEvent(state.hostId!, dispatch.sessionId, `Task ${task.id} spec frozen`, "running");

  const buildResult = await runCodexExec({
    cwd: workspace.path,
    prompt: proofBuilderPrompt(task, dispatch, workspace.path),
    sandbox: "workspace-write"
  });
  await writeRawArtifact(task, "build.txt", `${buildResult.stdout}\n\n--- STDERR ---\n\n${buildResult.stderr}`.trim());
  if (!buildResult.ok) {
    task = await updateEvidence(task, buildResult.summary, [
      path.join(task.rootPath, "spec.md"),
      path.join(task.rootPath, "raw", "build.txt")
    ]);
    await updateTaskPhase(state.hostId!, task.id, "build", task.verificationState);
    return {
      hostId: state.hostId!,
      dispatchId: dispatch.id,
      sessionId: dispatch.sessionId,
      ok: false,
      summary: buildResult.summary,
      stdoutArtifactPath: path.join(task.rootPath, "raw", "build.txt")
    };
  }
  task = await updateEvidence(task, buildResult.summary, [
    path.join(task.rootPath, "spec.md"),
    path.join(task.rootPath, "raw", "build.txt")
  ]);
  await updateTaskPhase(state.hostId!, task.id, task.phase, task.verificationState);
  await updateSessionEvent(state.hostId!, dispatch.sessionId, `Task ${task.id} evidence updated`, "verifying");

  await updateTaskPhase(state.hostId!, task.id, "verify", "running");
  const firstVerifier = await runVerifier(task, workspace, "verifier-1.txt");
  const firstVerdict = parseVerifierVerdict(firstVerifier.summary);
  let verdict = await writeVerificationVerdict({
    task,
    runId: `vrf_${Date.now()}`,
    status: firstVerdict,
    checks: [
      {
        name: "codex-verifier",
        ok: firstVerdict === "passed",
        detail: firstVerifier.summary
      }
    ],
    findings: firstVerdict === "passed" ? [] : [firstVerifier.summary],
    summary: firstVerifier.summary
  });
  task = verdict.task;
  await updateTaskPhase(state.hostId!, task.id, task.phase, task.verificationState);

  if (firstVerdict === "failed") {
    await updateSessionEvent(state.hostId!, dispatch.sessionId, `Task ${task.id} verifier reported findings; running minimal fix`, "running");
    const fixerResult = await runCodexExec({
      cwd: workspace.path,
      prompt: proofFixerPrompt(task, workspace.path),
      sandbox: "workspace-write"
    });
    await writeRawArtifact(task, "fixer.txt", `${fixerResult.stdout}\n\n--- STDERR ---\n\n${fixerResult.stderr}`.trim());
    task = await updateEvidence(task, `${fixerResult.summary}\n\nFresh verification required.`, [
      path.join(task.rootPath, "spec.md"),
      path.join(task.rootPath, "raw", "build.txt"),
      path.join(task.rootPath, "raw", "fixer.txt"),
      path.join(task.rootPath, "raw", "verifier-1.txt")
    ]);
    await updateTaskPhase(state.hostId!, task.id, "fix", task.verificationState);

    await updateTaskPhase(state.hostId!, task.id, "verify", "running");
    const secondVerifier = await runVerifier(task, workspace, "verifier-2.txt");
    const secondVerdict = parseVerifierVerdict(secondVerifier.summary);
    verdict = await writeVerificationVerdict({
      task,
      runId: `vrf_${Date.now()}_2`,
      status: secondVerdict,
      checks: [
        {
          name: "codex-verifier-fresh",
          ok: secondVerdict === "passed",
          detail: secondVerifier.summary
        }
      ],
      findings: secondVerdict === "passed" ? [] : [secondVerifier.summary],
      summary: secondVerifier.summary
    });
    task = verdict.task;
    await updateTaskPhase(state.hostId!, task.id, task.phase, task.verificationState);
  }

  return {
    hostId: state.hostId!,
    dispatchId: dispatch.id,
    sessionId: dispatch.sessionId,
    ok: task.verificationState === "passed",
    summary: task.verificationState === "passed" ? `Proof task ${task.id} passed fresh verification.` : `Proof task ${task.id} failed verification. Inspect problems.md.`,
    stdoutArtifactPath: path.join(task.rootPath, "raw", "build.txt")
  };
}

async function processDispatch(state: DaemonState, dispatch: PendingDispatch): Promise<void> {
  if (!state.hostId) {
    throw new Error("Host is not paired");
  }

  const journal = await loadJournal();
  const compacted = compactJournal(journal);
  journal.entries = compacted.entries;
  const existing = journal.entries.find((entry) => entry.dispatchId === dispatch.id);
  if (existing?.state === "running") {
    logger.warn("Dispatch already running, skipping duplicate start", { dispatchId: dispatch.id });
    return;
  }

  const entry: LocalJournalEntry = {
    sessionId: dispatch.sessionId,
    dispatchId: dispatch.id,
    state: "running",
    lastUpdatedAt: nowIso()
  };
  journal.entries = journal.entries.filter((item) => item.dispatchId !== dispatch.id);
  journal.entries.push(entry);
  await saveJournal(journal);

  await ackDispatch(dispatch, state.hostId);
  let completion: DaemonCompleteRequest;
  try {
    if (dispatch.executionKind === "bootstrap_doctor" || dispatch.executionKind === "bootstrap_verify") {
      completion = await processBootstrapDispatch(state, dispatch);
    } else {
      const workspace = state.workspaces.find((item) => item.id === dispatch.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${dispatch.workspaceId} is not registered on this host`);
      }

      completion = dispatch.mode === "proof"
        ? await processProofDispatch(state, dispatch, workspace)
        : await processQuickDispatch(state, dispatch, workspace);
    }
    entry.state = completion.ok ? "completed" : "failed";
    entry.lastUpdatedAt = nowIso();
    await saveJournal(journal);
    await completeDispatch(state.hostId, completion);
  } catch (error) {
    entry.state = "failed";
    entry.lastUpdatedAt = nowIso();
    await saveJournal(journal);
    const message = error instanceof Error ? error.message : "Unknown dispatch error";
    await completeDispatch(state.hostId, {
      hostId: state.hostId,
      dispatchId: dispatch.id,
      sessionId: dispatch.sessionId,
      ok: false,
      summary: message
    });
    throw error;
  }
}

async function runOnce(): Promise<void> {
  const readiness = await checkCodexReadiness();
  const state = await loadState();
  const guidance = firstRunGuidance({
    hostId: state.hostId,
    readinessAvailable: readiness.available,
    readinessMissing: readiness.missing
  });

  if (guidance === codexCliMissingMessage()) {
    emitStartupNotice("codex-missing", guidance);
    return;
  }
  clearStartupNotice("codex-missing");

  if (guidance === hostNotPairedMessage()) {
    emitStartupNotice("host-not-paired", guidance);
    return;
  }
  clearStartupNotice("host-not-paired");

  const helloResult = await hello(state);
  if (!helloResult.state.hostId) {
    throw new Error("Host pairing is incomplete");
  }

  await heartbeat(helloResult.state.hostId);
  const dispatches = helloResult.dispatches.length > 0 ? helloResult.dispatches : await poll(helloResult.state.hostId);
  for (const dispatch of dispatches) {
    await processDispatch(helloResult.state, dispatch);
  }
}

async function runLoop(): Promise<void> {
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      logger.error("Daemon loop failure", {
        message: error instanceof Error ? error.message : String(error)
      });
    }

    await new Promise((resolve) => setTimeout(resolve, heartbeatMs));
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";
  switch (command) {
    case "pair":
      await pairHost(process.argv[3]);
      return;
    case "once":
      await runOnce();
      return;
    case "run":
    default:
      await runLoop();
      return;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
