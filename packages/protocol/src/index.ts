export const SESSION_STATES = [
  "created",
  "prefetching",
  "awaiting_policy",
  "awaiting_approval",
  "pending_dispatch",
  "running",
  "paused",
  "reconnecting",
  "verifying",
  "completed",
  "failed",
  "cancelled"
] as const;

export const TASK_PHASES = [
  "init",
  "spec_frozen",
  "build",
  "evidence",
  "verify",
  "fix",
  "complete"
] as const;

export const APPROVAL_STATES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "cancelled"
] as const;

export const POLICY_LAYERS = [
  "global",
  "deployment",
  "workspace",
  "session",
  "command"
] as const;

export const VERIFICATION_STATES = [
  "not_started",
  "running",
  "passed",
  "failed",
  "blocked"
] as const;

export const ACTION_KINDS = [
  "read_status",
  "workspace_read",
  "workspace_write",
  "workspace_write_outside_root",
  "git_push",
  "bootstrap_install",
  "bootstrap_config_edit",
  "daemon_pair",
  "session_resume",
  "verification_run"
] as const;

export const EVENT_NAMES = [
  "session.created",
  "session.prefetch.completed",
  "policy.evaluated",
  "approval.requested",
  "approval.resolved",
  "host.connected",
  "host.disconnected",
  "task.phase.changed",
  "runtime.exec.started",
  "runtime.exec.summary",
  "artifact.synced",
  "verification.completed",
  "session.completed",
  "session.failed"
] as const;

export const DAEMON_MESSAGE_TYPES = [
  "host.hello",
  "host.heartbeat",
  "host.resume",
  "session.dispatch",
  "session.control",
  "session.event",
  "artifact.sync",
  "approval.blocked"
] as const;

export const DISPATCH_EXECUTION_KINDS = [
  "runtime_session",
  "bootstrap_doctor",
  "bootstrap_verify"
] as const;

export type SessionState = (typeof SESSION_STATES)[number];
export type TaskPhase = (typeof TASK_PHASES)[number];
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export type PolicyLayer = (typeof POLICY_LAYERS)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];
export type EventName = (typeof EVENT_NAMES)[number];
export type DaemonMessageType = (typeof DAEMON_MESSAGE_TYPES)[number];
export type DispatchExecutionKind = (typeof DISPATCH_EXECUTION_KINDS)[number];

export interface User {
  id: string;
  displayName: string;
  status: "active" | "revoked";
  createdAt: string;
}

export interface TelegramIdentity {
  id: string;
  userId: string;
  telegramUserId: string;
  chatId: string;
  username?: string;
  linkedAt: string;
  status: "active" | "revoked";
}

export interface Host {
  id: string;
  label: string;
  fingerprint: string;
  status: "registering" | "paired" | "active" | "stale" | "revoked";
  capabilities: string[];
  lastSeenAt?: string;
  pairedUserId?: string;
  runtimePreference: "codex-cli";
  createdAt: string;
  updatedAt: string;
}

export interface HostRegistration {
  id: string;
  hostId: string;
  pairingCode: string;
  expiresAt: string;
  claimedByUserId?: string;
  status: "issued" | "claimed" | "expired";
  createdAt: string;
}

export interface Workspace {
  id: string;
  hostId: string;
  path: string;
  repoName: string;
  defaultBranch?: string;
  policyId?: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  hostId: string;
  workspaceId: string;
  mode: "quick" | "proof";
  runtime: "codex-cli";
  state: SessionState;
  taskId?: string;
  title: string;
  prompt: string;
  currentSummary?: string;
  lastError?: string;
  approvalId?: string;
  runtimeSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEvent<TPayload = Record<string, unknown>> {
  id: string;
  sessionId: string;
  type: EventName;
  payload: TPayload;
  occurredAt: string;
  sequence: number;
}

export interface TaskBundle {
  id: string;
  sessionId: string;
  workspaceId: string;
  rootPath: string;
  phase: TaskPhase;
  mode: "quick" | "proof";
  title: string;
  acceptanceCriteria: string[];
  verificationState: VerificationState;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  actionKind: ActionKind;
  state: ApprovalState;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDecision {
  id: string;
  approvalRequestId: string;
  actorUserId: string;
  decision: "approved" | "rejected" | "expired" | "cancelled";
  reason?: string;
  decidedAt: string;
}

export interface PolicyRule {
  id: string;
  actionKind: ActionKind;
  effect: "allow" | "deny" | "require_approval";
  reason: string;
}

export interface Policy {
  id: string;
  layer: PolicyLayer;
  scopeRef: string;
  rules: PolicyRule[];
  status: "active" | "superseded";
  version: number;
  createdAt: string;
}

export interface EvidenceArtifact {
  id: string;
  taskId: string;
  kind: "spec" | "evidence" | "verdict" | "problem" | "raw";
  path: string;
  sha256?: string;
  storageKind: "repo-local" | "object-store";
  createdAt: string;
}

export interface VerificationRun {
  id: string;
  taskId: string;
  sessionId: string;
  status: VerificationState;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
}

export interface RuntimeAdapterRecord {
  id: string;
  kind: "codex-cli" | "secondary";
  version?: string;
  capabilities: string[];
  status: "active" | "deprecated";
}

export interface HookDefinition {
  id: string;
  point: string;
  enabled: boolean;
  handlerRef?: string;
}

export interface HookExecution {
  id: string;
  hookId: string;
  sessionId?: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  outputRef?: string;
}

export interface AuditRecord {
  id: string;
  actorType: "user" | "host" | "system";
  actorRef: string;
  action: string;
  targetRef: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SecretReference {
  id: string;
  scope: string;
  provider: string;
  keyRef: string;
  rotatedAt?: string;
}

export interface BootstrapFinding {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
}

export interface BootstrapReport {
  id: string;
  hostFingerprint: string;
  command: "doctor" | "setup" | "repair" | "verify" | "status" | "config-init" | "env-snapshot";
  status: "pass" | "warn" | "fail";
  profileRecommendation?: "minimal" | "recommended" | "full" | "custom";
  findings: BootstrapFinding[];
  planPreview: string[];
  reportJson: Record<string, unknown>;
  createdAt: string;
}

export interface InstallPlan {
  id: string;
  reportId: string;
  profile: "minimal" | "recommended" | "full" | "custom";
  steps: string[];
  requiresElevation: boolean;
  status: "planned" | "applied" | "failed";
  createdAt: string;
}

export interface PendingDispatch {
  id: string;
  sessionId: string;
  hostId: string;
  workspaceId: string;
  executionKind: DispatchExecutionKind;
  mode: "quick" | "proof";
  runtime: "codex-cli";
  actionKind: ActionKind;
  prompt: string;
  title: string;
  taskId?: string;
  approvalId?: string;
  status: "queued" | "acked" | "running" | "completed" | "failed" | "cancelled";
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalJournalEntry {
  sessionId: string;
  dispatchId: string;
  state: "running" | "completed" | "failed";
  pid?: number;
  lastUpdatedAt: string;
}

export interface HappyTGStore {
  version: 1;
  users: User[];
  telegramIdentities: TelegramIdentity[];
  hosts: Host[];
  hostRegistrations: HostRegistration[];
  workspaces: Workspace[];
  sessions: Session[];
  sessionEvents: SessionEvent[];
  tasks: TaskBundle[];
  approvals: ApprovalRequest[];
  approvalDecisions: ApprovalDecision[];
  policies: Policy[];
  evidenceArtifacts: EvidenceArtifact[];
  verificationRuns: VerificationRun[];
  runtimeAdapters: RuntimeAdapterRecord[];
  hookDefinitions: HookDefinition[];
  hookExecutions: HookExecution[];
  auditRecords: AuditRecord[];
  secretReferences: SecretReference[];
  bootstrapReports: BootstrapReport[];
  installPlans: InstallPlan[];
  pendingDispatches: PendingDispatch[];
}

export interface PolicyEvaluationRequest {
  actionKind: ActionKind;
  scopeRefs: Partial<Record<PolicyLayer, string>>;
  policies: Policy[];
}

export interface PolicyMatch {
  policyId: string;
  layer: PolicyLayer;
  ruleId: string;
  effect: PolicyRule["effect"];
  reason: string;
}

export interface PolicyDecision {
  outcome: "allow" | "deny" | "require_approval";
  effectiveLayer: PolicyLayer;
  matches: PolicyMatch[];
  reason: string;
}

export interface RuntimeReadiness {
  runtime: "codex-cli";
  available: boolean;
  binaryPath?: string;
  version?: string;
  configPath: string;
  configExists: boolean;
  smokeOk: boolean;
  smokeOutput?: string;
  smokeError?: string;
}

export interface RuntimeExecutionResult {
  ok: boolean;
  timedOut?: boolean;
  summary: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  lastMessagePath?: string;
}

export interface CreatePairingRequest {
  hostLabel: string;
  fingerprint: string;
}

export interface CreatePairingResponse {
  hostId: string;
  registrationId: string;
  pairingCode: string;
  expiresAt: string;
}

export interface ClaimPairingRequest {
  pairingCode: string;
  telegramUserId: string;
  chatId: string;
  username?: string;
  displayName: string;
}

export interface CreateSessionRequest {
  userId: string;
  hostId: string;
  workspaceId: string;
  mode: "quick" | "proof";
  runtime: "codex-cli";
  title: string;
  prompt: string;
  acceptanceCriteria?: string[];
  riskyAction?: ActionKind;
}

export interface ResolveApprovalRequest {
  userId: string;
  decision: "approved" | "rejected";
  reason?: string;
}

export interface HostHelloRequest {
  hostId: string;
  fingerprint: string;
  capabilities: string[];
  workspaces: Array<{
    path: string;
    repoName: string;
    defaultBranch?: string;
  }>;
}

export interface HostHelloResponse {
  host: Host;
  workspaces: Workspace[];
  pendingDispatches: PendingDispatch[];
}

export interface HostHeartbeatRequest {
  hostId: string;
}

export interface HostPollRequest {
  hostId: string;
}

export interface DaemonDispatchAckRequest {
  hostId: string;
  dispatchId: string;
  sessionId: string;
  idempotencyKey: string;
}

export interface DaemonSessionEventRequest {
  hostId: string;
  sessionId: string;
  summary?: string;
  error?: string;
  state?: SessionState;
}

export interface DaemonTaskPhaseRequest {
  hostId: string;
  taskId: string;
  phase: TaskPhase;
  verificationState?: VerificationState;
}

export interface DaemonCompleteRequest {
  hostId: string;
  dispatchId: string;
  sessionId: string;
  ok: boolean;
  summary: string;
  stdoutArtifactPath?: string;
  stderrArtifactPath?: string;
}

export interface DaemonApprovalBlockedRequest {
  hostId: string;
  sessionId: string;
  actionKind: ActionKind;
  reason: string;
}

export function createEmptyStore(): HappyTGStore {
  return {
    version: 1,
    users: [],
    telegramIdentities: [],
    hosts: [],
    hostRegistrations: [],
    workspaces: [],
    sessions: [],
    sessionEvents: [],
    tasks: [],
    approvals: [],
    approvalDecisions: [],
    policies: [],
    evidenceArtifacts: [],
    verificationRuns: [],
    runtimeAdapters: [],
    hookDefinitions: [],
    hookExecutions: [],
    auditRecords: [],
    secretReferences: [],
    bootstrapReports: [],
    installPlans: [],
    pendingDispatches: []
  };
}
