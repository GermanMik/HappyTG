export type InstallRepoMode = "clone" | "update" | "current";
export type DirtyWorktreeStrategy = "cancel" | "stash" | "keep";
export type BackgroundMode = "launchagent" | "scheduled-task" | "startup" | "systemd-user" | "manual" | "skip";
export type PostInstallCheck = "setup" | "doctor" | "verify";
export type InstallStatus = "pass" | "warn" | "fail";
export type StepStatus = "pending" | "running" | "passed" | "warn" | "failed" | "skipped";
export type LinuxFamily = "debian" | "fedora" | "unknown";
export type SystemPackageManager = "brew" | "winget" | "choco" | "apt-get" | "dnf" | "manual";

export interface InstallCommandOptions {
  json: boolean;
  nonInteractive: boolean;
  cwd: string;
  launchCwd: string;
  bootstrapRepoRoot?: string;
  repoMode?: InstallRepoMode;
  repoDir?: string;
  repoUrl: string;
  branch: string;
  dirtyWorktreeStrategy?: DirtyWorktreeStrategy;
  telegramBotToken?: string;
  telegramAllowedUserIds: string[];
  telegramHomeChannel?: string;
  backgroundMode?: BackgroundMode;
  postChecks: PostInstallCheck[];
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

export interface InstallResult {
  kind: "install";
  status: InstallStatus;
  interactive: boolean;
  repo: {
    mode: InstallRepoMode;
    path: string;
    sync: "cloned" | "updated" | "reused";
    dirtyStrategy: DirtyWorktreeStrategy;
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
  reportJson: Record<string, unknown>;
}

