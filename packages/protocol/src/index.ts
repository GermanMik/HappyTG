export const SESSION_STATES = [
  "created",
  "preparing",
  "ready",
  "running",
  "blocked",
  "needs_approval",
  "verifying",
  "paused",
  "resuming",
  "completed",
  "failed",
  "cancelled"
] as const;

export const TASK_PHASES = [
  "quick",
  "freeze",
  "build",
  "evidence",
  "verify",
  "fix",
  "complete"
] as const;

export const APPROVAL_STATES = [
  "not_required",
  "pending",
  "waiting_human",
  "auto_allowed",
  "auto_denied",
  "approved_once",
  "approved_session",
  "approved_phase",
  "denied",
  "expired",
  "superseded"
] as const;

export const POLICY_LAYERS = [
  "global",
  "deployment",
  "workspace",
  "project",
  "session",
  "command"
] as const;

export const VERIFICATION_STATES = [
  "not_started",
  "queued",
  "running",
  "passed",
  "failed",
  "inconclusive",
  "stale"
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

export const APPROVAL_SCOPES = [
  "once",
  "phase",
  "session"
] as const;

export const MINIAPP_LAUNCH_KINDS = [
  "home",
  "workspace",
  "session",
  "task",
  "invite",
  "access_grant",
  "approval",
  "sessions",
  "approvals",
  "hosts",
  "reports",
  "diff",
  "verify"
] as const;

export const TOOL_CATEGORIES = [
  "safe_read",
  "bounded_compute",
  "repo_mutation",
  "shell_network_system_sensitive",
  "deploy_publish_external_side_effect"
] as const;

export const EVENT_NAMES = [
  "SessionCreated",
  "SessionAssigned",
  "SessionStarted",
  "SessionPaused",
  "SessionResumed",
  "SessionCompleted",
  "SessionFailed",
  "SessionCancelled",
  "UserMessageReceived",
  "TelegramCallbackReceived",
  "MiniAppOpened",
  "PromptBuilt",
  "ToolBatchPlanned",
  "ToolCallQueued",
  "ToolCallStarted",
  "ToolCallFinished",
  "ToolCallFailed",
  "ApprovalRequested",
  "ApprovalResolved",
  "ApprovalExpired",
  "VerificationStarted",
  "VerificationPassed",
  "VerificationFailed",
  "VerificationInconclusive",
  "TaskBundleInitialized",
  "TaskBundleUpdated",
  "SummaryGenerated",
  "HostHeartbeatReceived",
  "HostDisconnected",
  "HostReconnected",
  "HookExecutionStarted",
  "HookExecutionFinished",
  "PolicyEvaluated",
  "ArtifactSynced"
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
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];
export type MiniAppLaunchKind = (typeof MINIAPP_LAUNCH_KINDS)[number];
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];
export type EventName = (typeof EVENT_NAMES)[number];
export type DaemonMessageType = (typeof DAEMON_MESSAGE_TYPES)[number];
export type DispatchExecutionKind = (typeof DISPATCH_EXECUTION_KINDS)[number];

export interface EventContract {
  name: EventName;
  payloadShape: string;
  producer: string;
  consumers: string[];
  idempotencyNotes: string;
}

export const EVENT_CONTRACTS: EventContract[] = [
  {
    name: "SessionCreated",
    payloadShape: "{ mode, runtime, title?, workspaceId? }",
    producer: "control-plane",
    consumers: ["worker", "bot", "miniapp"],
    idempotencyNotes: "Session id plus event sequence is unique; duplicate creates must be rejected by idempotency key."
  },
  {
    name: "SessionAssigned",
    payloadShape: "{ hostId, workspaceId }",
    producer: "control-plane",
    consumers: ["host-daemon", "bot", "miniapp"],
    idempotencyNotes: "Assignment is idempotent for the same session and host pair."
  },
  {
    name: "SessionStarted",
    payloadShape: "{ dispatchId?, runtime }",
    producer: "host-daemon",
    consumers: ["worker", "bot", "miniapp"],
    idempotencyNotes: "Dispatch id prevents duplicate starts after reconnect."
  },
  {
    name: "ApprovalRequested",
    payloadShape: "{ approvalId, risk, scope, reason, expiresAt }",
    producer: "approval-engine",
    consumers: ["bot", "miniapp", "worker"],
    idempotencyNotes: "Approval id and nonce make repeated renders safe."
  },
  {
    name: "ApprovalResolved",
    payloadShape: "{ approvalId, decision, actorUserId? }",
    producer: "bot-or-miniapp",
    consumers: ["worker", "host-daemon", "audit"],
    idempotencyNotes: "Resolution is accepted only once; repeated callbacks return the stored decision."
  },
  {
    name: "TaskBundleInitialized",
    payloadShape: "{ taskId, rootPath, phase }",
    producer: "repo-proof",
    consumers: ["control-plane", "miniapp"],
    idempotencyNotes: "Task id maps to one bundle root."
  },
  {
    name: "TaskBundleUpdated",
    payloadShape: "{ taskId, phase, verificationState?, artifactCount? }",
    producer: "repo-proof-or-host-daemon",
    consumers: ["control-plane", "bot", "miniapp"],
    idempotencyNotes: "Phase history in state.json provides replay-safe ordering."
  },
  {
    name: "VerificationStarted",
    payloadShape: "{ taskId, runId, verifierRole }",
    producer: "host-daemon",
    consumers: ["bot", "miniapp", "audit"],
    idempotencyNotes: "Run id distinguishes fresh verifier passes."
  },
  {
    name: "VerificationPassed",
    payloadShape: "{ taskId, runId, summary }",
    producer: "host-daemon",
    consumers: ["bot", "miniapp", "audit"],
    idempotencyNotes: "A pass becomes stale if a later mutation event is appended."
  },
  {
    name: "VerificationFailed",
    payloadShape: "{ taskId, runId, findings }",
    producer: "host-daemon",
    consumers: ["bot", "miniapp", "audit"],
    idempotencyNotes: "Failures are append-only and require a later fix plus fresh verify."
  },
  {
    name: "HostHeartbeatReceived",
    payloadShape: "{ hostId, lastSeenAt }",
    producer: "host-daemon",
    consumers: ["worker", "miniapp"],
    idempotencyNotes: "Latest timestamp wins; old heartbeats are ignored by projections."
  },
  {
    name: "HostDisconnected",
    payloadShape: "{ hostId, reconciliation }",
    producer: "worker",
    consumers: ["bot", "miniapp", "session-engine"],
    idempotencyNotes: "Repeated disconnect events for stale hosts collapse in projections."
  },
  {
    name: "SummaryGenerated",
    payloadShape: "{ summary, source }",
    producer: "runtime-adapter",
    consumers: ["bot", "miniapp"],
    idempotencyNotes: "Summaries are append-only; session projection stores latest summary."
  }
];

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

export interface MiniAppLaunchGrant {
  id: string;
  kind: MiniAppLaunchKind;
  targetId?: string;
  userId?: string;
  issuedByUserId?: string;
  payload: string;
  nonce: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MiniAppSession {
  id: string;
  userId: string;
  telegramUserId: string;
  launchGrantId?: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  lastSeenAt: string;
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
  scope?: ApprovalScope;
  nonce?: string;
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
  decision: "approved_once" | "approved_phase" | "approved_session" | "denied" | "expired" | "superseded";
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

export interface MCPBinding {
  id: string;
  workspaceId?: string;
  hostId?: string;
  serverName: string;
  status: "active" | "disabled" | "revoked";
  allowedTools: string[];
  createdAt: string;
  updatedAt: string;
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
  miniAppLaunchGrants: MiniAppLaunchGrant[];
  miniAppSessions: MiniAppSession[];
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
  mcpBindings: MCPBinding[];
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
  missing?: boolean;
  binaryPath?: string;
  version?: string;
  configPath: string;
  configExists: boolean;
  smokeOk: boolean;
  smokeTimedOut?: boolean;
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
  scope?: ApprovalScope;
  nonce?: string;
  reason?: string;
}

export interface CreateMiniAppLaunchGrantRequest {
  userId?: string;
  issuedByUserId?: string;
  kind: MiniAppLaunchKind;
  targetId?: string;
  ttlSeconds?: number;
  maxUses?: number;
}

export interface CreateMiniAppLaunchGrantResponse {
  grant: MiniAppLaunchGrant;
  startAppPayload: string;
  launchUrl?: string;
}

export interface CreateMiniAppSessionRequest {
  initData: string;
  startAppPayload?: string;
}

export interface CreateMiniAppSessionResponse {
  appSession: {
    id: string;
    token: string;
    expiresAt: string;
  };
  user: User;
  launch?: {
    kind: MiniAppLaunchKind;
    targetId?: string;
    expired?: boolean;
    revoked?: boolean;
  };
}

export interface MiniAppAttentionItem {
  id: string;
  kind: "approval" | "session" | "host" | "verification" | "draft";
  title: string;
  detail: string;
  severity: "info" | "warn" | "danger";
  href: string;
  nextAction: string;
}

export interface MiniAppDashboardProjection {
  stats: {
    activeSessions: number;
    pendingApprovals: number;
    blockedSessions: number;
    verifyProblems: number;
  };
  lastContext?: {
    hostId?: string;
    hostLabel?: string;
    workspaceId?: string;
    repoName?: string;
  };
  attention: MiniAppAttentionItem[];
  recentSessions: MiniAppSessionCard[];
  recentReports: MiniAppReportCard[];
}

export interface MiniAppSessionCard {
  id: string;
  title: string;
  state: SessionState;
  phase?: TaskPhase;
  verificationState?: VerificationState;
  hostLabel?: string;
  repoName?: string;
  lastUpdatedAt: string;
  attention?: string;
  href: string;
  nextAction: string;
}

export interface MiniAppApprovalCard {
  id: string;
  sessionId: string;
  title: string;
  reason: string;
  risk: ApprovalRequest["risk"];
  state: ApprovalState;
  expiresAt: string;
  scope?: ApprovalScope;
  nonce?: string;
  href: string;
}

export interface MiniAppHostCard {
  id: string;
  label: string;
  status: Host["status"];
  lastSeenAt?: string;
  activeSessions: number;
  repoNames: string[];
  lastError?: string;
  href: string;
}

export interface MiniAppReportCard {
  id: string;
  title: string;
  status: VerificationState | SessionState;
  generatedAt: string;
  href: string;
}

export interface MiniAppDiffProjection {
  sessionId: string;
  taskId?: string;
  summary: {
    changedFiles: number;
    insertions?: number;
    deletions?: number;
    highRiskFiles: string[];
  };
  files: Array<{
    path: string;
    category: "code" | "config" | "test" | "docs" | "artifact";
    status: "added" | "modified" | "deleted" | "unknown";
    summary: string;
  }>;
  rawAvailable: boolean;
}

export interface MiniAppVerifyProjection {
  sessionId: string;
  taskId?: string;
  state: VerificationState;
  checkedCriteria: string[];
  failedCriteria: string[];
  nextAction: string;
  reportHref?: string;
  evidenceHref?: string;
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
    miniAppLaunchGrants: [],
    miniAppSessions: [],
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
    mcpBindings: [],
    hookDefinitions: [],
    hookExecutions: [],
    auditRecords: [],
    secretReferences: [],
    bootstrapReports: [],
    installPlans: [],
    pendingDispatches: []
  };
}
