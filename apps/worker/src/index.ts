import { refreshExpiredApproval } from "../../../packages/approval-engine/src/index.js";
import { FileStateStore, createLogger } from "../../../packages/shared/src/index.js";

import {
  markExpiredApprovalSessions,
  reconcileSessionsAndDispatches,
  summarizeReconcileResult,
  updateHostStatuses
} from "./reconcile.js";

const logger = createLogger("worker");
const store = new FileStateStore();
const staleAfterMs = Number(process.env.HOST_STALE_AFTER_MS ?? 20_000);
const orphanAfterMs = Number(process.env.DISPATCH_ORPHAN_AFTER_MS ?? 300_000);
const tickMs = Number(process.env.WORKER_TICK_MS ?? 5_000);

async function runTick(): Promise<void> {
  const now = Date.now();
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
}

setInterval(() => {
  void runTick();
}, tickMs);

void runTick();
logger.info("Worker started", { tickMs, staleAfterMs, orphanAfterMs });
