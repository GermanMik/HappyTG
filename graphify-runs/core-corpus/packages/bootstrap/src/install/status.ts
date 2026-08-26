import type { InstallOutcome, InstallRuntimeErrorDetail, InstallStatus, InstallStepRecord } from "./types.js";

const RECOVERABLE_ERROR_CODES = new Set<InstallRuntimeErrorDetail["code"]>([
  "repo_connectivity_failure",
  "repo_retry_exhausted",
  "repo_fallback_failure",
  "command_spawn_failure",
  "windows_shim_failure",
  "command_execution_failure",
  "pnpm_install_failed",
  "installer_validation_failure",
  "installer_partial_failure"
]);

function firstDetailLine(detail: string): string {
  return detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "Installer step failed.";
}

export function installStatusFromOutcome(outcome: InstallOutcome): InstallStatus {
  switch (outcome) {
    case "success":
      return "pass";
    case "success-with-warnings":
      return "warn";
    case "recoverable-failure":
    case "fatal-failure":
    default:
      return "fail";
  }
}

export function installOutcomeFromError(detail: InstallRuntimeErrorDetail): InstallOutcome {
  return RECOVERABLE_ERROR_CODES.has(detail.code) ? "recoverable-failure" : "fatal-failure";
}

export function createPartialFailureDetail(steps: InstallStepRecord[]): InstallRuntimeErrorDetail | undefined {
  const failedSteps = steps.filter((step) => step.status === "failed");
  if (failedSteps.length === 0) {
    return undefined;
  }

  const firstFailedStep = failedSteps[0]!;
  return {
    code: "installer_partial_failure",
    message: failedSteps.length === 1
      ? `${firstFailedStep.label} still needs attention.`
      : `${failedSteps.length} installer steps still need attention.`,
    lastError: firstDetailLine(firstFailedStep.detail),
    retryable: false,
    suggestedAction: failedSteps.length === 1
      ? `Resolve the ${firstFailedStep.label} issue, then rerun the installer.`
      : `Resolve the reported failed steps, then rerun the installer.`
  };
}

export function deriveInstallOutcome(input: {
  warnings: string[];
  steps: InstallStepRecord[];
  error?: InstallRuntimeErrorDetail;
}): InstallOutcome {
  if (input.error) {
    return installOutcomeFromError(input.error);
  }

  if (input.steps.some((step) => step.status === "failed")) {
    return "recoverable-failure";
  }

  if (input.warnings.length > 0 || input.steps.some((step) => step.status === "warn")) {
    return "success-with-warnings";
  }

  return "success";
}
