# memory-leak-audit-20260426 Spec

## Status

Frozen at 2026-04-26.

## Objective

Audit HappyTG runtime code for potential memory leaks and retained resources. This is an audit-only task: do not change production code unless a later user request explicitly authorizes fixes.

## In Scope

- Runtime TypeScript/JavaScript under:
  - `apps/api/src`
  - `apps/bot/src`
  - `apps/host-daemon/src`
  - `apps/miniapp/src`
  - `apps/worker/src`
  - `packages/approval-engine/src`
  - `packages/bootstrap/src`
  - `packages/hooks/src`
  - `packages/policy-engine/src`
  - `packages/protocol/src`
  - `packages/repo-proof/src`
  - `packages/runtime-adapters/src`
  - `packages/session-engine/src`
  - `packages/shared/src`
  - `packages/telegram-kit/src`
- Runtime scripts under `scripts/` when they start processes, streams, watchers, or long-running work.
- Installer/runtime shell scripts under `scripts/install/` where they manage long-running processes or resources.
- Existing tests only as supporting evidence for lifecycle behavior, not as primary audit targets.

## Out of Scope

- `node_modules`, `.turbo`, coverage/build/dist outputs, logs, generated output artifacts.
- Historical proof bundles except as examples of process discipline.
- Broad refactoring, dependency upgrades, or production-code fixes.
- Security audit outside resource-retention concerns.

## Risk Patterns To Check

- `setInterval`, `setTimeout`, retries, polling loops.
- Event listeners and subscriptions without removal/unsubscribe.
- Telegram bot handlers, webhook/polling lifecycle, WebSocket-like long-running connections.
- Child processes, streams, file watchers.
- Queues, pending promises, abort/cancel handling.
- Global `Map`/`Set`/cache state without TTL, size limit, lifecycle cleanup, or acceptable singleton semantics.
- React hooks: `useEffect` cleanup, subscriptions, intervals, async effects.
- Long-running agent/orchestrator processes.
- Lazy and cache-aware initialization paths.
- Serialized queue and approval/policy flows.

## Required Evidence

- `evidence.md`: searched patterns, files inspected, commands run, and verification notes.
- `evidence.json`: machine-readable command and finding summary.
- `problems.md`: every risk with file:line, retained resource, growth scenario, why cleanup is insufficient, risk level, and minimal fix.
- `verdict.json`: final status and risk counts.
- Raw command outputs in `.agent/tasks/memory-leak-audit-20260426/raw/`.

## Verification Commands

Record outputs for:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg verify`

If a command is unavailable or blocked by the current repo state, record the exact output and mark it as blocked instead of silently omitting it.

## Dynamic Verification Plan

If the repo exposes a practical long-running service entrypoint, propose or add a lightweight memory smoke test script only if it can be done without heavy dependencies and without production refactoring. The smoke test should start a process, run a repeated workload, trigger GC when available, sample `process.memoryUsage()`, and check that `heapUsed`/`rss` do not grow monotonically after warmup.

Because this task is audit-first, adding such a smoke test requires a minimal, clearly scoped proof artifact or a follow-up fix authorization if it touches production code.

## Acceptance Criteria

- Scope is frozen before audit commands.
- Runtime code is searched for the requested retention patterns.
- Findings distinguish real leak risks from acceptable singleton/cache patterns.
- High/medium risks include a minimal fix plan but no code changes.
- Standard verification command outputs are captured under `raw/`.
- Fresh verifier pass reviews the evidence and verdict without editing production code.
