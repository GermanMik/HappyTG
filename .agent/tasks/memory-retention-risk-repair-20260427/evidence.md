# memory-retention-risk-repair-20260427 Evidence

## Scope Freeze

`spec.md` was frozen on 2026-04-27 before production edits.

## Session Start

- Read `AGENTS.md`.
- Retrieved EchoVault project context with `memory context --project`.
- Searched relevant EchoVault memories and inspected available details for the audit and verify repeat.
- Created branch `codex/memory-retention-risk-repair-20260427`.

## Source Audit Bundle

The repair started from `.agent/tasks/memory-leak-audit-20260426/`, whose verdict remains fail due to H1/M1/M2/M3 and low L1/L2 risks. The earlier `pnpm happytg verify` crash was cleared on 2026-04-27; the command exited 0 with WARN status.

## Build Notes

- H1/M1 runtime adapter: `packages/runtime-adapters/src/index.ts` now uses bounded stdout/stderr buffers, truncation metadata, timeout grace escalation, Windows process-tree force kill through `taskkill`, and deterministic timeout settlement if `close` is delayed or absent.
- M2 control plane: `apps/worker/src/reconcile.ts` adds `compactControlPlaneRecords`; worker ticks compact expired Mini App grants/sessions, stale host registrations, terminal approvals, and terminal dispatches while preserving active records.
- M3 serialized store queue: `apps/api/src/service.ts` injects repo-proof operations and moves proof `initTaskBundle`, `recordTaskApproval`, and `advanceTaskPhase` filesystem work outside `FileStateStore.update` critical sections. Failed task init/approval recording updates the session to failed through a separate bounded store mutation.
- Fresh verifier found an edge case where failed `recordTaskApproval` left a waiting approval actionable. The fixer now marks that approval `superseded`; `apps/api/src/service.test.ts` covers that replay cannot dispatch the failed session.
- L1 Telegram wizard drafts: `apps/bot/src/handlers.ts` sweeps expired drafts opportunistically during message/callback handling and wizard start without adding an interval.
- L2 Mini App auth retry: `apps/miniapp/src/index.ts` keeps one pending `waitForTelegramInitData` timer chain and reuses it on retry clicks.
- Runtime output metadata was added to `RuntimeExecutionResult` in `packages/protocol/src/index.ts`.

## Verification Commands

- `pnpm --filter @happytg/runtime-adapters test`: pass, `raw/focused-runtime-adapters-test.txt`.
- `pnpm --filter @happytg/api test`: pass, `raw/focused-api-test.txt`.
- `pnpm --filter @happytg/worker test`: pass, `raw/focused-worker-test.txt`.
- `pnpm --filter @happytg/bot test`: pass, `raw/focused-bot-test.txt`.
- `pnpm --filter @happytg/miniapp test`: pass, `raw/focused-miniapp-test.txt`.
- Focused typecheck for runtime-adapters, api, worker, bot, miniapp: pass, `raw/focused-*-typecheck.txt`.
- `pnpm build`: pass, `raw/build.txt`.
- `pnpm lint`: pass, `raw/lint.txt`.
- `pnpm typecheck`: pass, `raw/typecheck.txt`.
- `pnpm test`: pass, `raw/test-unit.txt`.
- `pnpm happytg doctor`: exit 0 with HappyTG WARN, `raw/happytg-doctor.txt`.
- `pnpm happytg verify`: exit 0 with HappyTG WARN, `raw/happytg-verify.txt`; copied to canonical `raw/test-integration.txt`.
- `pnpm release:check -- --version 0.4.6`: pass, `raw/release-check-versioned.txt`.

## Dynamic Verification

`raw/memory-smoke.mjs` / `raw/memory-smoke.txt` ran with `node --expose-gc --import tsx`:

- Repeated large-output Codex harness runs confirmed stdout/stderr truncation.
- Repeated hung-child harness runs confirmed timeout settlement with exit code 124.
- Control-plane compaction removed 250 expired Mini App launch grants and 250 expired Mini App sessions.
- `global.gc?.()` memory samples were captured after each iteration. RSS rose mildly during child iterations and dropped from `96194560` to `95719424` after compaction; no unbounded output strings or unresolved child waits were retained by the smoke.

## Fresh Verifier Pass

Read-only verifier pass reviewed the changed surfaces, focused tests, full verification logs, and dynamic smoke. It found one failure-path issue in proof approval recording; the fixer resolved it and full verification was rerun after the fix. The pass status is WARN only because `pnpm happytg verify` reports environment warnings unrelated to the retention fixes: Codex websocket 403 fallback to HTTP and public Caddy Mini App route identity mismatch while local HappyTG services are already running.
