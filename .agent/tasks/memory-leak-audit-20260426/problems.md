# memory-leak-audit-20260426 Problems

## H1 - Child process timeout can retain a hung Codex process forever

- Risk: high.
- File: `packages/runtime-adapters/src/index.ts:332`.
- What is retained: the spawned child process, stdout/stderr listeners, accumulated `stdout`/`stderr` strings, the unresolved `runCommand` promise, and the host-daemon dispatch waiting on `runCodexExec`.
- Growth scenario: a Codex CLI or shell wrapper hangs, ignores `SIGTERM`, or leaves a child tree alive after `HAPPYTG_CODEX_EXEC_TIMEOUT_MS`. The timeout handler only calls `child.kill("SIGTERM")`; the promise resolves only on `close`.
- Why cleanup is insufficient: there is no grace timer, no `SIGKILL` escalation, no process-tree cleanup on Windows, and no fallback resolution/rejection if `close` never arrives.
- Minimal fix: on timeout, mark settled, kill the process, start a short grace timer, escalate to forceful termination, and resolve/reject deterministically even if `close` is not delivered. Prefer a shared child-process runner so bootstrap helpers inherit the same behavior.

## M1 - Child process output is buffered without a size cap

- Risk: medium.
- Files:
  - `packages/runtime-adapters/src/index.ts:337`
  - `packages/runtime-adapters/src/index.ts:341`
  - `packages/bootstrap/src/install/commands.ts:252`
  - `packages/bootstrap/src/install/commands.ts:255`
  - `packages/bootstrap/src/index.ts:524`
  - `packages/bootstrap/src/index.ts:527`
- What is retained: complete stdout/stderr text in process memory until the child exits.
- Growth scenario: Codex execution, installer commands, or diagnostics emit large streaming output. The daemon then writes combined output to raw artifacts, so peak memory is at least the full captured stdout plus stderr, and can grow much larger than the useful summary.
- Why cleanup is insufficient: listeners append every chunk to strings and there is no byte limit, ring buffer, streaming-to-file path, or truncation metadata.
- Minimal fix: cap in-memory stdout/stderr buffers, stream full raw output directly to task files when needed, and keep only bounded tails for summaries/errors.

## M2 - Control-plane state keeps expired/terminal records indefinitely

- Risk: medium.
- Files:
  - `apps/api/src/service.ts:428`
  - `apps/api/src/service.ts:510`
  - `apps/api/src/service.ts:683`
  - `apps/api/src/service.ts:865`
  - `apps/api/src/service.ts:959`
  - `apps/worker/src/reconcile.ts:154`
- What is retained: `miniAppLaunchGrants`, `miniAppSessions`, `hostRegistrations`, `approvals`, session events, audit records, completed/failed dispatches, and related persisted arrays loaded into memory by `FileStateStore.read()`.
- Growth scenario: repeated Mini App launches, session creation, pairing attempts, approval requests, and completed runtime sessions add records forever. The worker refreshes/marks expired approvals but does not compact them.
- Why cleanup is insufficient: TTLs are validated for individual grants/sessions/approvals, but there is no retention job that removes or archives expired and terminal records. Because the store is a JSON file loaded as a full object, persisted data growth becomes request-time heap growth.
- Minimal fix: add bounded retention/compaction in the worker or service layer for expired launch grants, expired Mini App sessions, stale host registrations, terminal approvals, old dispatches, and optionally old audit/session events with a documented retention window.

## M3 - Serialized state queue can retain pending callers behind async filesystem work

- Risk: medium.
- Files:
  - `packages/shared/src/index.ts:707`
  - `packages/shared/src/index.ts:721`
  - `apps/api/src/service.ts:818`
  - `apps/api/src/service.ts:867`
  - `apps/api/src/service.ts:1126`
- What is retained: the `FileStateStore.queue` promise chain, closures for queued API mutations, loaded store snapshots, request objects waiting for the queue, and filesystem work launched inside mutators.
- Growth scenario: proof task creation or task phase updates perform repo-proof filesystem operations inside `this.store.update(async ...)`. If those filesystem operations are slow or hang, later mutating API requests queue behind them and accumulate pending promises.
- Why cleanup is insufficient: the queue correctly serializes writes, but it has no timeout/cancellation policy and currently includes non-store filesystem work in the serialized critical section.
- Minimal fix: keep the critical section store-only where possible; perform repo-proof filesystem operations before/after the store mutation with idempotent reconciliation, or add bounded timeouts and structured failure paths for queued mutations.

## L1 - Telegram task wizard drafts expire only on later same-user access

- Risk: low.
- File: `apps/bot/src/handlers.ts:529`.
- What is retained: one `TaskWizardDraft` per Telegram user id in `wizardDrafts`.
- Growth scenario: many users start `/task` or tap the task wizard and abandon it. `DRAFT_TTL_MS` is enforced only when the same user later calls a wizard path through `getFreshDraft`.
- Why cleanup is insufficient: abandoned users that never return are not swept from the Map.
- Minimal fix: opportunistically sweep expired drafts on `startTaskWizard` and callback/message dispatch, or use a small interval tied to bot lifecycle with cleanup in bot `stop()`.

## L2 - Mini App auth retry can create overlapping bounded timeout chains

- Risk: low.
- File: `apps/miniapp/src/index.ts:967`.
- What is retained: pending `setTimeout` callbacks closing over auth state while waiting for Telegram `initData`.
- Growth scenario: repeated clicks on the auth retry control can call `waitForTelegramInitData()` multiple times, producing overlapping polling chains until each reaches `initDataWaitTimeoutMs`.
- Why cleanup is insufficient: there is no single timer id or in-flight guard for the wait loop. The risk is bounded by the timeout and page lifetime, so it is low.
- Minimal fix: store the timer id and clear/reuse it on retry, or guard with `authWaitInFlight`.

## Cleared Blocker - Standard verify command previously crashed

- Risk: audit blocker, not classified as a memory leak. Cleared on repeat.
- Command: `pnpm happytg verify`.
- Evidence: `raw/happytg-verify.txt`, `raw/happytg-verify-repeat-20260427.txt`.
- Observed first run: PowerShell surfaced `-1073740791`; pnpm reported exit code `3221226505`.
- Repeat result on 2026-04-27: exit code `0`, HappyTG verify status `WARN`.
- Remaining environment warnings: Codex websocket 403 fallback to HTTP, public Caddy Mini App route HTTP 502, repo services not running for pairing/API flow.
- Minimal fix: no memory-audit fix required for the cleared crash; handle the remaining Caddy/service WARNs through normal runtime/deployment follow-up.
