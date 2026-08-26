import type { HookDefinition, HookExecution } from "../../protocol/src/index.js";
import { createId, nowIso } from "../../shared/src/index.js";

export type HookPoint =
  | "session.start"
  | "session.end"
  | "task.init"
  | "task.freeze"
  | "task.build"
  | "task.evidence"
  | "task.verify"
  | "task.fix"
  | "task.complete"
  | "tool.pre"
  | "tool.post"
  | "approval.requested"
  | "approval.resolved"
  | "summary.emitted"
  | "host.connected"
  | "host.disconnected"
  | "resume";

export function defineHook(point: HookPoint, handlerRef?: string): HookDefinition {
  return {
    id: createId("hook"),
    point,
    enabled: true,
    handlerRef
  };
}

export async function executeHook(hook: HookDefinition, sessionId?: string): Promise<HookExecution> {
  const startedAt = nowIso();
  return {
    id: createId("hke"),
    hookId: hook.id,
    sessionId,
    status: "completed",
    startedAt,
    finishedAt: nowIso(),
    outputRef: hook.handlerRef
  };
}
