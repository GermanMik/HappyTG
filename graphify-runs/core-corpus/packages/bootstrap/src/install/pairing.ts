import path from "node:path";

import type { Host } from "../../../protocol/src/index.js";
import { getLocalStateDir, readJsonFile } from "../../../shared/src/index.js";

import type { CommandRunResult } from "./commands.js";

export interface DaemonStateSnapshot {
  hostId?: string;
  fingerprint?: string;
  apiBaseUrl?: string;
  lastHelloAt?: string;
}

export interface PairingCommandResult {
  pairingCode: string;
  hostId?: string;
  expiresAt?: string;
}

export type PairingProbeStatus = Host["status"] | "not-found" | "unreachable";

export interface PairingProbeResult {
  hostId: string;
  status: PairingProbeStatus;
  apiBaseUrl: string;
  error?: string;
}

export type InstallPairingDecision =
  | {
    state: "not-required";
  }
  | {
    state: "reuse-existing-host";
    daemonState: DaemonStateSnapshot;
    probe: PairingProbeResult & {
      status: Extract<PairingProbeStatus, "paired" | "active">;
    };
  }
  | {
    state: "auto-requested";
    daemonState: DaemonStateSnapshot;
    pairResult: PairingCommandResult;
    reason: "no-local-host" | "host-refresh-required";
    probe?: PairingProbeResult;
  }
  | {
    state: "manual-fallback";
    daemonState: DaemonStateSnapshot;
    reason: "probe-unavailable" | "request-failed";
    probe?: PairingProbeResult;
  };

export type ResolveExecutableImpl = (command: string, options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}) => Promise<string | undefined>;

export type RunCommandImpl = (input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: boolean;
}) => Promise<CommandRunResult>;

function defaultApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return env.HAPPYTG_API_URL?.trim() || "http://localhost:4000";
}

export async function readDaemonStateSnapshot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<DaemonStateSnapshot> {
  const statePath = path.join(getLocalStateDir(env, platform), "daemon-state.json");
  return readJsonFile<DaemonStateSnapshot>(statePath, {});
}

export function pairingHandoffMessage(pairTarget: string, pairingCode: string): string {
  return pairTarget.toLowerCase().includes("telegram")
    ? `Send \`/pair ${pairingCode}\` in Telegram.`
    : `Send \`/pair ${pairingCode}\` to ${pairTarget}.`;
}

export function parsePairingCommandResult(output: string): PairingCommandResult | undefined {
  const pairingCode = output.match(/\/pair\s+([A-Z0-9-]+)/u)?.[1];
  if (!pairingCode) {
    return undefined;
  }

  return {
    pairingCode,
    hostId: output.match(/Host ID:\s+([^\r\n]+)/u)?.[1]?.trim(),
    expiresAt: output.match(/Expires at:\s+([^\r\n]+)/u)?.[1]?.trim()
  };
}

export async function requestPairingCode(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  repoPath: string;
  runCommandImpl: RunCommandImpl;
  resolveExecutableImpl: ResolveExecutableImpl;
}): Promise<PairingCommandResult | undefined> {
  const pnpmPath = await input.resolveExecutableImpl("pnpm", {
    cwd: input.repoPath,
    env: input.env,
    platform: input.platform
  });
  if (!pnpmPath) {
    return undefined;
  }

  const result = await input.runCommandImpl({
    command: pnpmPath,
    args: ["daemon:pair"],
    cwd: input.repoPath,
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);
  if (!result || result.exitCode !== 0) {
    return undefined;
  }

  return parsePairingCommandResult(`${result.stdout}\n${result.stderr}`);
}

export async function fetchPairingHostStatus(input: {
  daemonState: DaemonStateSnapshot;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  hostId: string;
}): Promise<PairingProbeResult> {
  const apiBaseUrl = input.daemonState.apiBaseUrl?.trim() || defaultApiBaseUrl(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(new URL("/api/v1/hosts", apiBaseUrl), {
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) {
      return {
        hostId: input.hostId,
        status: "unreachable",
        apiBaseUrl,
        error: `Host status probe failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
      };
    }

    const payload = await response.json() as { hosts?: Array<Pick<Host, "id" | "status">> };
    if (!Array.isArray(payload.hosts)) {
      return {
        hostId: input.hostId,
        status: "unreachable",
        apiBaseUrl,
        error: "Host status probe returned an unexpected payload."
      };
    }

    const host = payload.hosts.find((item) => item.id === input.hostId);
    return {
      hostId: input.hostId,
      status: host?.status ?? "not-found",
      apiBaseUrl
    };
  } catch (error) {
    return {
      hostId: input.hostId,
      status: "unreachable",
      apiBaseUrl,
      error: error instanceof Error ? error.message : "Unknown host status probe failure."
    };
  }
}

export async function evaluateInstallPairingDecision(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  pairingRequested: boolean;
  platform: NodeJS.Platform;
  repoPath: string;
  resolveExecutableImpl: ResolveExecutableImpl;
  runCommandImpl: RunCommandImpl;
  fetchPairingHostStatusImpl?: typeof fetchPairingHostStatus;
}): Promise<InstallPairingDecision> {
  if (!input.pairingRequested) {
    return {
      state: "not-required"
    };
  }

  const daemonState = await readDaemonStateSnapshot(input.env, input.platform);
  if (!daemonState.hostId) {
    const pairResult = await requestPairingCode({
      env: input.env,
      platform: input.platform,
      repoPath: input.repoPath,
      runCommandImpl: input.runCommandImpl,
      resolveExecutableImpl: input.resolveExecutableImpl
    });
    return pairResult
      ? {
        state: "auto-requested",
        daemonState,
        pairResult,
        reason: "no-local-host"
      }
      : {
        state: "manual-fallback",
        daemonState,
        reason: "request-failed"
      };
  }

  const probe = await (input.fetchPairingHostStatusImpl ?? fetchPairingHostStatus)({
    daemonState,
    env: input.env,
    fetchImpl: input.fetchImpl,
    hostId: daemonState.hostId
  });
  if (probe.status === "active" || probe.status === "paired") {
    return {
      state: "reuse-existing-host",
      daemonState,
      probe: {
        ...probe,
        status: probe.status
      }
    };
  }

  if (probe.status === "registering" || probe.status === "stale" || probe.status === "revoked" || probe.status === "not-found") {
    const pairResult = await requestPairingCode({
      env: input.env,
      platform: input.platform,
      repoPath: input.repoPath,
      runCommandImpl: input.runCommandImpl,
      resolveExecutableImpl: input.resolveExecutableImpl
    });
    return pairResult
      ? {
        state: "auto-requested",
        daemonState,
        pairResult,
        reason: "host-refresh-required",
        probe
      }
      : {
        state: "manual-fallback",
        daemonState,
        reason: "request-failed",
        probe
      };
  }

  return {
    state: "manual-fallback",
    daemonState,
    reason: "probe-unavailable",
    probe
  };
}
