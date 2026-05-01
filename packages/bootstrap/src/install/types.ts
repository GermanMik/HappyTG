import type { AutomationItem } from "../finalization.js";

export type InstallRepoMode = "clone" | "update" | "current";
export type DirtyWorktreeStrategy = "cancel" | "stash" | "keep";
export type BackgroundMode = "launchagent" | "scheduled-task" | "startup" | "systemd-user" | "manual" | "skip";
export type InstallLaunchMode = "local" | "docker" | "manual" | "skip";
export type InstallLaunchStatus = "not-started" | "started" | "skipped" | "failed";
export type DockerServiceStrategy = "isolated" | "reuse";
export type DockerServiceId = "redis" | "postgres" | "minio" | "caddy";
export type DockerCaddyAction = "compose" | "reuse-system" | "print-snippet" | "patch-system" | "skip";
export const DEFAULT_WINDOWS_DAEMON_TASK_NAME = "HappyTG Host Daemon";
export type PostInstallCheck = "setup" | "doctor" | "verify";
export type InstallStatus = "pass" | "warn" | "fail";
export type InstallOutcome = "success" | "success-with-warnings" | "recoverable-failure" | "fatal-failure";
export type StepStatus = "pending" | "running" | "passed" | "warn" | "failed" | "skipped";
export type LinuxFamily = "debian" | "fedora" | "unknown";
export type SystemPackageManager = "brew" | "winget" | "choco" | "apt-get" | "dnf" | "manual";
export type RepoSourceId = "primary" | "fallback" | "local";
export type TelegramLookupStep = "getMe";
export type TelegramLookupFailureKind =
  | "missing_token"
  | "invalid_token"
  | "network_error"
  | "api_error"
  | "unexpected_response";
export type InstallRuntimeErrorCode =
  | "repo_connectivity_failure"
  | "repo_retry_exhausted"
  | "repo_fallback_failure"
  | "command_spawn_failure"
  | "windows_shim_failure"
  | "command_execution_failure"
  | "pnpm_install_failed"
  | "installer_validation_failure"
  | "installer_partial_failure"
  | "installer_runtime_failure";

export interface InstallCommandOptions {
  json: boolean;
  nonInteractive: boolean;
  cwd: string;
  launchCwd: string;
  bootstrapRepoRoot?: string;
  repoMode?: InstallRepoMode;
  repoDir?: string;
  repoUrl?: string;
  branch: string;
  dirtyWorktreeStrategy?: DirtyWorktreeStrategy;
  telegramBotToken?: string;
  telegramAllowedUserIds: string[];
  telegramHomeChannel?: string;
  backgroundMode?: BackgroundMode;
  launchMode?: InstallLaunchMode;
  dockerServiceStrategy?: DockerServiceStrategy;
  dockerCaddyAction?: DockerCaddyAction;
  caddyfilePath?: string;
  postChecks: PostInstallCheck[];
}

export interface InstallerRepoSource {
  id: Extract<RepoSourceId, "primary" | "fallback">;
  label: string;
  url: string;
}

export interface InstallerRepoSourceResolution {
  primary: InstallerRepoSource;
  fallback?: InstallerRepoSource;
  sources: InstallerRepoSource[];
}

export interface PlatformSnapshot {
  platform: NodeJS.Platform;
  arch: string;
  shell: string;
  linuxFamily: LinuxFamily;
  systemPackageManager: SystemPackageManager;
  repoPackageManager: "pnpm";
  isInteractiveTerminal: boolean;
}

export interface DependencyDetection {
  id: "git" | "nodejs" | "pnpm" | "codex-cli" | "docker";
  label: string;
  available: boolean;
  required: boolean;
  version?: string;
  binaryPath?: string;
  installCommand?: string;
  manualInstruction?: string;
  reason?: string;
}

export interface InstallerEnvironment {
  platform: PlatformSnapshot;
  dependencies: DependencyDetection[];
}

export interface RepoInspection {
  path: string;
  exists: boolean;
  isRepo: boolean;
  emptyDirectory: boolean;
  dirty: boolean;
  rootPath?: string;
  branch?: string;
  remoteUrl?: string;
}

export interface RepoModeChoice {
  mode: InstallRepoMode;
  label: string;
  path: string;
  available: boolean;
  detail: string;
}

export interface RepoSelection {
  mode: InstallRepoMode;
  path: string;
  dirtyStrategy: DirtyWorktreeStrategy;
}

export interface RepoSyncProgressEvent {
  phase: "attempt" | "retry" | "switch-source";
  source: InstallerRepoSource;
  attempt: number;
  maxAttempts: number;
  detail: string;
  errorMessage?: string;
  retryable?: boolean;
  backoffMs?: number;
}

export interface RepoSyncResult {
  path: string;
  sync: "cloned" | "updated" | "reused";
  attempts: number;
  repoSource: RepoSourceId;
  repoUrl: string;
  fallbackUsed: boolean;
}

export interface TelegramSetup {
  botToken: string;
  allowedUserIds: string[];
  homeChannel: string;
}

export interface TelegramBotIdentity {
  ok: boolean;
  id?: number;
  username?: string;
  firstName?: string;
  error?: string;
  step?: TelegramLookupStep;
  failureKind?: TelegramLookupFailureKind;
  recoverable?: boolean;
  statusCode?: number;
  transportProbeValidated?: boolean;
}

export interface TelegramLookupDiagnostic {
  attempted: boolean;
  step: TelegramLookupStep;
  status: "not-attempted" | "validated" | "warning" | "failed";
  message: string;
  failureKind?: TelegramLookupFailureKind;
  recoverable: boolean;
  affectsConfiguration: boolean;
}

export interface EnvWriteResult {
  envFilePath: string;
  created: boolean;
  changed: boolean;
  backupPath?: string;
  addedKeys: string[];
  preservedKeys: string[];
}

export type OwnedBackgroundArtifactKind =
  | "launcher"
  | "launchagent"
  | "scheduled-task"
  | "startup-shortcut"
  | "systemd-user-unit";

export interface OwnedBackgroundArtifact {
  kind: OwnedBackgroundArtifactKind;
  mode: BackgroundMode;
  path?: string;
  taskName?: string;
}

export interface BackgroundSetupResult {
  mode: BackgroundMode;
  status: "configured" | "manual" | "skipped" | "failed";
  detail: string;
  artifactPath?: string;
  launcherPath?: string;
  ownedArtifacts?: OwnedBackgroundArtifact[];
}

export interface InstallLaunchCommandResult {
  id: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface InstallLaunchHealthCheck {
  id: string;
  label: string;
  status: InstallStatus;
  detail: string;
  url?: string;
}

export interface SystemCaddyPlan {
  action: DockerCaddyAction;
  status: "compose" | "reuse" | "snippet" | "patched" | "skipped" | "blocked" | "failed";
  detail: string;
  caddyfilePath?: string;
  snippetPath?: string;
  backupPath?: string;
  commands: string[];
  warnings: string[];
}

export interface DockerServiceStrategyPlan {
  strategy: DockerServiceStrategy;
  reusedServices: DockerServiceId[];
  composeServices: string[];
  env: Record<string, string>;
  overrideFiles: string[];
  detail: string;
  caddy?: SystemCaddyPlan;
}

export interface InstallLaunchResult {
  mode: InstallLaunchMode;
  status: InstallLaunchStatus;
  detail: string;
  composeFile?: string;
  command?: string;
  dockerServicePlan?: DockerServiceStrategyPlan;
  commands: InstallLaunchCommandResult[];
  health: InstallLaunchHealthCheck[];
  warnings: string[];
  nextSteps: string[];
}

export interface InstallStepRecord {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  progress?: {
    completed: number;
    total: number;
    label?: string;
  };
}

export interface InstallRuntimeErrorDetail {
  code: InstallRuntimeErrorCode;
  message: string;
  lastError: string;
  retryable: boolean;
  suggestedAction: string;
  attempts?: number;
  repoUrl?: string;
  repoSource?: RepoSourceId;
  failedCommand?: string;
  failedBinary?: string;
  binaryPath?: string;
  fallbackUsed?: boolean;
}

export interface InstallDraftState {
  version: 1;
  repo?: {
    mode?: InstallRepoMode;
    dir?: string;
    path?: string;
    source?: RepoSourceId;
    url?: string;
    branch?: string;
    dirtyStrategy?: DirtyWorktreeStrategy;
  };
  telegram?: TelegramSetup;
  backgroundMode?: BackgroundMode;
  launchMode?: InstallLaunchMode;
  dockerServiceStrategy?: DockerServiceStrategy;
  dockerCaddyAction?: DockerCaddyAction;
  postChecks?: PostInstallCheck[];
  updatedAt: string;
}

export interface InstallResult {
  kind: "install";
  status: InstallStatus;
  outcome: InstallOutcome;
  interactive: boolean;
  tuiHandled: boolean;
  repo: {
    mode: InstallRepoMode;
    path: string;
    sync: "cloned" | "updated" | "reused";
    dirtyStrategy: DirtyWorktreeStrategy;
    source: RepoSourceId;
    repoUrl: string;
    attempts: number;
    fallbackUsed: boolean;
  };
  environment: InstallerEnvironment;
  telegram: {
    configured: boolean;
    allowedUserIds: string[];
    homeChannel?: string;
    bot?: TelegramBotIdentity;
    lookup?: TelegramLookupDiagnostic;
  };
  background: BackgroundSetupResult;
  launch: InstallLaunchResult;
  finalization?: {
    items: AutomationItem[];
  };
  postChecks: Array<{
    command: PostInstallCheck;
    status: InstallStatus;
    summary: string;
  }>;
  steps: InstallStepRecord[];
  nextSteps: string[];
  warnings: string[];
  error?: InstallRuntimeErrorDetail;
  reportJson: Record<string, unknown>;
}
