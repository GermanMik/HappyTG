import type { InstallRuntimeErrorCode, InstallRuntimeErrorDetail, RepoSourceId } from "./types.js";

export class InstallRuntimeError extends Error {
  readonly detail: InstallRuntimeErrorDetail;

  constructor(detail: InstallRuntimeErrorDetail) {
    super(detail.message);
    this.name = "InstallRuntimeError";
    this.detail = detail;
  }
}

export function isInstallRuntimeError(error: unknown): error is InstallRuntimeError {
  return error instanceof InstallRuntimeError;
}

function detailFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown install runtime failure.";
}

export function createInstallRuntimeError(detail: InstallRuntimeErrorDetail): InstallRuntimeError {
  return new InstallRuntimeError(detail);
}

export function toInstallRuntimeErrorDetail(error: unknown, fallback?: Partial<InstallRuntimeErrorDetail>): InstallRuntimeErrorDetail {
  if (isInstallRuntimeError(error)) {
    return error.detail;
  }

  const lastError = detailFromUnknown(error);
  return {
    code: fallback?.code ?? "installer_runtime_failure",
    message: fallback?.message ?? lastError,
    lastError,
    retryable: fallback?.retryable ?? false,
    suggestedAction: fallback?.suggestedAction ?? "Review the installer output, fix the reported prerequisite or network issue, then rerun the installer.",
    attempts: fallback?.attempts,
    repoUrl: fallback?.repoUrl,
    repoSource: fallback?.repoSource,
    failedCommand: fallback?.failedCommand,
    failedBinary: fallback?.failedBinary,
    binaryPath: fallback?.binaryPath,
    fallbackUsed: fallback?.fallbackUsed
  };
}

export function isRetryableRepoFailureMessage(message: string): boolean {
  return /(unable to access|failed to connect|could not connect|connection timed out|could not resolve host|connection reset|network is unreachable|remote end hung up unexpectedly|early eof|timeout)/iu.test(message);
}

export function isRetryableCommandOutput(output: string): boolean {
  return /(econnreset|etimedout|eai_again|socket hang up|network timeout|connection reset|temporary failure|failed to fetch)/iu.test(output);
}

export function repoFailureCode(input: {
  repoSource: RepoSourceId;
  exhausted: boolean;
}): InstallRuntimeErrorCode {
  if (input.repoSource === "fallback" && input.exhausted) {
    return "repo_fallback_failure";
  }

  if (input.exhausted) {
    return "repo_retry_exhausted";
  }

  return "repo_connectivity_failure";
}

export function repoFailureSuggestedAction(input: {
  repoSource: RepoSourceId;
  retryable: boolean;
  fallbackUsed: boolean;
}): string {
  if (input.retryable && input.repoSource === "fallback") {
    return "Both configured repository sources were unreachable. Check network access to the configured remotes or retry later.";
  }

  if (input.retryable) {
    return "Check network access to the HappyTG repository remote and rerun the installer.";
  }

  if (input.fallbackUsed) {
    return "Review the repository checkout state and configured fallback source, then rerun the installer.";
  }

  return "Review the repository checkout state, branch selection, and local Git configuration, then rerun the installer.";
}
