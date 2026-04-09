# Evidence Summary

## Root Cause

1. `packages/shared/src/index.ts`
   Home-based runtime defaults were split across two paths: `resolveHome()` used env-aware home expansion, but `getLocalStateDir()` built its fallback from `os.homedir()` directly. That made Windows runtime/test overrides non-authoritative for default state/home-derived paths.

2. `packages/runtime-adapters/src/index.ts`
   Codex readiness treated any unavailable invocation as effectively "missing" and did not preserve whether the binary was actually absent. The runtime also depended only on direct resolution/spawn semantics, so Windows shim cases could still degrade into false negatives in daemon startup messaging.

3. `apps/bot/src/index.ts`
   Bot startup loaded `.env`, but if the process already carried a missing/placeholder Telegram token state, startup behavior could stay misconfigured without rescuing a valid token from the discovered `.env`. Missing-token guidance also did not distinguish `.env`-missing from `.env`-present scenarios.

## Changed Files

- `packages/shared/src/index.ts`
- `packages/shared/src/index.test.ts`
- `packages/runtime-adapters/src/index.ts`
- `packages/runtime-adapters/src/index.test.ts`
- `packages/protocol/src/index.ts`
- `apps/host-daemon/src/index.ts`
- `apps/host-daemon/src/index.test.ts`
- `apps/bot/src/index.ts`
- `apps/bot/src/index.test.ts`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Windows home resolution honors env overrides for `~` and `~/...` and remains predictable in runtime defaults. | `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`, `raw/test-unit.txt` |
| Windows regression coverage exists for home resolution and runtime home-derived state paths. | `packages/shared/src/index.test.ts`, `raw/test-unit.txt` |
| Windows Codex detection no longer false-negatives on shim/PATH scenarios and distinguishes true missing binaries. | `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `packages/protocol/src/index.ts`, `apps/host-daemon/src/index.ts`, `apps/host-daemon/src/index.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Bot first-run behavior either recovers a valid token from `.env` or prints a short actionable message. | `apps/bot/src/index.ts`, `apps/bot/src/index.test.ts`, `raw/test-unit.txt` |
| `pnpm typecheck`, `pnpm test`, and `pnpm build` pass. | `raw/typecheck.txt`, `raw/test-integration.txt`, `raw/build.txt` |

## Verification

- Targeted tests:
  - `pnpm --filter @happytg/shared test`
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm --filter @happytg/host-daemon test`
  - `pnpm --filter @happytg/bot test`
- Repo gates:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`

## Outcomes

- `pnpm lint`: passed
- `pnpm typecheck`: passed across 13 tasks
- `pnpm test`: passed across 13 tasks
- `pnpm build`: passed across 13 tasks

## Residual Risk

- Windows runtime behavior is verified through Windows-like shim/path tests plus repo suites in this environment; no interactive long-running `pnpm dev` session was kept open on a real Windows host during this task.
