import { fileURLToPath } from "node:url";

import { refreshExpiredApproval } from "../../../packages/approval-engine/src/index.js";
import { FileStateStore, createJsonServer, createLogger, json, route, type Logger } from "../../../packages/shared/src/index.js";

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

const port = Number(process.env.PORT ?? 4200);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtime = createWorkerRuntime();
  const server = createWorkerServer(runtime);
  runtime.start();
  server.listen(port, () => {
    runtime.logger.info("Worker probe server listening", { port });
  });
}
