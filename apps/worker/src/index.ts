import { refreshExpiredApproval } from "../../../packages/approval-engine/src/index.js";
import { FileStateStore, createLogger } from "../../../packages/shared/src/index.js";

const logger = createLogger("worker");
const store = new FileStateStore();
const staleAfterMs = Number(process.env.HOST_STALE_AFTER_MS ?? 20_000);
const tickMs = Number(process.env.WORKER_TICK_MS ?? 5_000);

async function runTick(): Promise<void> {
  const now = Date.now();
  await store.update((state) => {
    let updatedHosts = 0;
    let updatedApprovals = 0;

    for (const host of state.hosts) {
      if (!host.lastSeenAt) {
        continue;
      }

      const ageMs = now - new Date(host.lastSeenAt).getTime();
      const nextStatus = ageMs > staleAfterMs ? "stale" : host.pairedUserId ? "active" : host.status;
      if (host.status !== nextStatus) {
        host.status = nextStatus;
        host.updatedAt = new Date(now).toISOString();
        updatedHosts += 1;
      }
    }

    for (const approval of state.approvals) {
      const refreshed = refreshExpiredApproval(approval, new Date(now));
      if (refreshed.state !== approval.state) {
        Object.assign(approval, refreshed);
        updatedApprovals += 1;
      }
    }

    if (updatedHosts > 0 || updatedApprovals > 0) {
      logger.info("Worker projection maintenance tick", { updatedHosts, updatedApprovals });
    }
  });
}

setInterval(() => {
  void runTick();
}, tickMs);

void runTick();
logger.info("Worker started", { tickMs, staleAfterMs });
