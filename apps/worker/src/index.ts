import { fileURLToPath } from "node:url";

import { refreshExpiredApproval } from "../../../packages/approval-engine/src/index.js";
import {
  FileStateStore,
  createJsonServer,
  createLogger,
  json,
  loadHappyTGEnv,
  readPort,
  route,
  type Logger
} from "../../../packages/shared/src/index.js";

import {
  markExpiredApprovalSessions,
  reconcileSessionsAndDispatches,
  summarizeReconcileResult,
  updateHostStatuses
} from "./reconcile.js";

export interface WorkerRuntimeOptions {
  store?: FileStateStore;
  logger?: Logger;
  staleAfterMs?: number;
  orphanAfterMs?: number;
  tickMs?: number;
  readyMaxLagMs?: number;
}

export interface WorkerReadinessSnapshot {
  ok: boolean;
  service: "worker";
  tickMs: number;
  staleAfterMs: number;
  orphanAfterMs: number;
  readyMaxLagMs: number;
  lastTickStatus: "idle" | "running" | "ok" | "error";
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastTickLagMs?: number;
  lastError?: string;
}

loadHappyTGEnv();

export function createWorkerRuntime(options: WorkerRuntimeOptions = {}) {
  const logger = options.logger ?? createLogger("worker");
  const store = options.store ?? new FileStateStore();
  const staleAfterMs = options.staleAfterMs ?? Number(process.env.HOST_STALE_AFTER_MS ?? 20_000);
  const orphanAfterMs = options.orphanAfterMs ?? Number(process.env.DISPATCH_ORPHAN_AFTER_MS ?? 300_000);
  const tickMs = options.tickMs ?? Number(process.env.WORKER_TICK_MS ?? 5_000);
  const readyMaxLagMs = options.readyMaxLagMs ?? Number(process.env.WORKER_READY_MAX_LAG_MS ?? tickMs * 3);

  let interval: NodeJS.Timeout | undefined;
  let lastTickStatus: WorkerReadinessSnapshot["lastTickStatus"] = "idle";
  let lastTickStartedAt: string | undefined;
  let lastTickFinishedAt: string | undefined;
  let lastError: string | undefined;

  async function runTick(): Promise<void> {
    const now = Date.now();
    lastTickStatus = "running";
    lastTickStartedAt = new Date(now).toISOString();

    try {
      await store.update((state) => {
        const updatedHosts = updateHostStatuses(state, now, staleAfterMs);
        let updatedApprovals = 0;

        for (const approval of state.approvals) {
          const refreshed = refreshExpiredApproval(approval, new Date(now));
          if (refreshed.state !== approval.state) {
            Object.assign(approval, refreshed);
            updatedApprovals += 1;
          }
        }

        const pausedSessions = markExpiredApprovalSessions(state, now);
        const reconcileResult = reconcileSessionsAndDispatches(state, now, {
          staleAfterMs,
          orphanAfterMs
        });

        const summary = summarizeReconcileResult({
          updatedHosts,
          updatedApprovals,
          pausedSessions,
          sessionsMovedToReconnecting: reconcileResult.sessionsMovedToReconnecting,
          sessionsFailed: reconcileResult.sessionsFailed,
          dispatchesFailed: reconcileResult.dispatchesFailed
        });

        if (summary) {
          logger.info("Worker projection maintenance tick", {
            summary
          });
        }
      });

      lastTickStatus = "ok";
      lastError = undefined;
    } catch (error) {
      lastTickStatus = "error";
      lastError = error instanceof Error ? error.message : "Unknown error";
      logger.error("Worker tick failed", {
        detail: lastError
      });
      throw error;
    } finally {
      lastTickFinishedAt = new Date().toISOString();
    }
  }

  function healthSnapshot(): WorkerReadinessSnapshot {
    const lastTickLagMs = lastTickFinishedAt ? Date.now() - Date.parse(lastTickFinishedAt) : undefined;
    return {
      ok: true,
      service: "worker",
      tickMs,
      staleAfterMs,
      orphanAfterMs,
      readyMaxLagMs,
      lastTickStatus,
      lastTickStartedAt,
      lastTickFinishedAt,
      lastTickLagMs,
      lastError
    };
  }

  function readinessSnapshot(now = Date.now()): WorkerReadinessSnapshot {
    const lastTickLagMs = lastTickFinishedAt ? now - Date.parse(lastTickFinishedAt) : undefined;
    const ready = lastTickStatus !== "error"
      && Boolean(lastTickFinishedAt)
      && typeof lastTickLagMs === "number"
      && lastTickLagMs <= readyMaxLagMs;

    return {
      ok: ready,
      service: "worker",
      tickMs,
      staleAfterMs,
      orphanAfterMs,
      readyMaxLagMs,
      lastTickStatus,
      lastTickStartedAt,
      lastTickFinishedAt,
      lastTickLagMs,
      lastError
    };
  }

  function start(): void {
    if (interval) {
      return;
    }

    void runTick().catch(() => undefined);
    interval = setInterval(() => {
      void runTick().catch(() => undefined);
    }, tickMs);
    logger.info("Worker started", { tickMs, staleAfterMs, orphanAfterMs, readyMaxLagMs });
  }

  function stop(): void {
    if (!interval) {
      return;
    }

    clearInterval(interval);
    interval = undefined;
  }

  return {
    logger,
    runTick,
    start,
    stop,
    healthSnapshot,
    readinessSnapshot
  };
}

export function createWorkerServer(runtime = createWorkerRuntime()) {
  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        json(res, 200, runtime.healthSnapshot());
      }),
      route("GET", "/ready", async ({ res }) => {
        const snapshot = runtime.readinessSnapshot();
        json(res, snapshot.ok ? 200 : 503, snapshot);
      })
    ],
    runtime.logger
  );
}

export function formatWorkerPortReuseMessage(listenPort: number): string {
  return `Port ${listenPort} already has a HappyTG Worker. Reuse the running worker if it is yours, or start a new one with HAPPYTG_WORKER_PORT/PORT, then try again.`;
}

export function formatWorkerPortConflictMessageDetailed(
  listenPort: number,
  options?: {
    service?: string;
    description?: string;
  }
): string {
  if (options?.service) {
    return `Port ${listenPort} is already in use by HappyTG ${options.service}, not HappyTG Worker. Free it, or start the worker with HAPPYTG_WORKER_PORT/PORT, then try again.`;
  }

  if (options?.description) {
    return `Port ${listenPort} is already in use by ${options.description}. Free it, or start the worker with HAPPYTG_WORKER_PORT/PORT, then try again.`;
  }

  return `Port ${listenPort} is already in use by another process. Free it, or start the worker with HAPPYTG_WORKER_PORT/PORT, then try again.`;
}

export interface WorkerStartupResult {
  status: "listening" | "reused";
  port: number;
}

interface PortOccupantInfo {
  service?: string;
  description?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function detectPortOccupant(listenPort: number, fetchImpl: typeof fetch = fetch): Promise<PortOccupantInfo> {
  for (const pathname of ["/ready", "/health", "/"]) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${listenPort}${pathname}`, {
        signal: AbortSignal.timeout(750)
      });
      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = contentType.includes("application/json") || contentType.startsWith("text/")
        ? await response.text()
        : "";
      if (contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(bodyText) as { service?: string };
          if (payload.service) {
            return {
              service: payload.service
            };
          }
        } catch {
          // Ignore malformed JSON and keep probing for another fingerprint.
        }
      }

      if (!response.ok) {
        continue;
      }

      const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/iu);
      const title = titleMatch?.[1]?.trim();
      return {
        description: title ? `HTTP listener (${title})` : `HTTP listener (${response.status})`
      };
    } catch {
      continue;
    }
  }

  return {};
}

export async function startWorkerServer(
  server = createWorkerServer(),
  options?: {
    port?: number;
    logger?: Pick<Logger, "info">;
    fetchImpl?: typeof fetch;
    reuseProbeWindowMs?: number;
    reuseProbeIntervalMs?: number;
    onListening?(): void;
  }
): Promise<WorkerStartupResult> {
  const listenPort = options?.port ?? port;
  const activeLogger = options?.logger ?? createLogger("worker");
  const fetchImpl = options?.fetchImpl ?? fetch;
  const reuseProbeWindowMs = options?.reuseProbeWindowMs ?? 2_000;
  const reuseProbeIntervalMs = options?.reuseProbeIntervalMs ?? Math.min(100, reuseProbeWindowMs);

  async function listenOnce(): Promise<"listening" | "in_use"> {
    return await new Promise<"listening" | "in_use">((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve("listening");
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EADDRINUSE") {
          resolve("in_use");
          return;
        }
        reject(error);
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(listenPort);
    });
  }

  if (await listenOnce() === "listening") {
    options?.onListening?.();
    activeLogger.info("Worker probe server listening", { port: listenPort });
    return { status: "listening", port: listenPort };
  }

  const occupant = await detectPortOccupant(listenPort, fetchImpl);
  if (occupant.service !== "worker") {
    throw new Error(formatWorkerPortConflictMessageDetailed(listenPort, occupant));
  }

  if (reuseProbeWindowMs > 0) {
    for (let waitedMs = 0; waitedMs < reuseProbeWindowMs; waitedMs += reuseProbeIntervalMs) {
      await delay(reuseProbeIntervalMs);
      const occupantAfterDelay = await detectPortOccupant(listenPort, fetchImpl);
      if (!occupantAfterDelay.service && !occupantAfterDelay.description) {
        if (await listenOnce() === "listening") {
          options?.onListening?.();
          activeLogger.info("Worker probe server listening", { port: listenPort });
          return { status: "listening", port: listenPort };
        }

        const retryOccupant = await detectPortOccupant(listenPort, fetchImpl);
        if (retryOccupant.service !== "worker") {
          throw new Error(formatWorkerPortConflictMessageDetailed(listenPort, retryOccupant));
        }
        continue;
      }

      if (occupantAfterDelay.service !== "worker") {
        throw new Error(formatWorkerPortConflictMessageDetailed(listenPort, occupantAfterDelay));
      }
    }
  }

  activeLogger.info(formatWorkerPortReuseMessage(listenPort), { port: listenPort });
  return { status: "reused", port: listenPort };
}

const port = readPort(process.env, ["HAPPYTG_WORKER_PORT", "PORT"], 4200);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtime = createWorkerRuntime();
  const server = createWorkerServer(runtime);
  void startWorkerServer(server, {
    port,
    logger: runtime.logger,
    onListening: () => {
      runtime.start();
    }
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Worker failed to start.");
    process.exitCode = 1;
  });
}
