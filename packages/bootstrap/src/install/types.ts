export type InstallRepoMode = "clone" | "update" | "current";
export type DirtyWorktreeStrategy = "cancel" | "stash" | "keep";
export type BackgroundMode = "launchagent" | "scheduled-task" | "startup" | "systemd-user" | "manual" | "skip";
export type PostInstallCheck = "setup" | "doctor" | "verify";
export type InstallStatus = "pass" | "warn" | "fail";
export type InstallOutcome = "success" | "success-with-warnings" | "recoverable-failure" | "fatal-failure";
export type StepStatus = "pending" | "running" | "passed" | "warn" | "failed" | "skipped";
export type LinuxFamily = "debian" | "fedora" | "unknown";
export type SystemPackageManager = "brew" | "winget" | "choco" | "apt-get" | "dnf" | "manual";
export type RepoSourceId = "primary" | "fallback" | "local";
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
}

export interface EnvWriteResult {
  envFilePath: string;
  created: boolean;
  changed: boolean;
  backupPath?: string;
  addedKeys: string[];
  preservedKeys: string[];
}

export interface BackgroundSetupResult {
  mode: BackgroundMode;
  status: "configured" | "manual" | "skipped" | "failed";
  detail: string;
  artifactPath?: string;
  launcherPath?: string;
}

export interface InstallStepRecord {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
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
  };
  background: BackgroundSetupResult;
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
