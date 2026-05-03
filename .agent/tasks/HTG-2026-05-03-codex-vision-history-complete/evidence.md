# HTG-2026-05-03 Codex Vision History Complete Evidence

## Init

- EchoVault project context and relevant memory search were run before work.
- Branch `codex/happytg-codex-vision-history-complete` was created from clean `main`.
- Spec was frozen before production-code changes.

## Initial Hypothesis

The prior `0.4.10` repair intentionally left Codex Desktop visibility as sanitized metadata-only. The likely remaining work is bounded, sanitized Desktop history/transcript preview across API and Mini App while preserving unsupported Desktop control.

## Code Map

- `packages/protocol/src/index.ts`
  - Added `CodexDesktopHistoryEntry` and `CodexDesktopSessionDetail`.
  - Entries carry explicit `source: "codex-desktop"`.
- `packages/runtime-adapters/src/codex-desktop.ts`
  - Existing Desktop project/session projection remains read-only.
  - Added bounded session detail/history extraction from local `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl`.
  - History summaries are projected strings, not raw JSON payload dumps.
  - Secret-like fields and values are redacted; output is capped by `HAPPYTG_CODEX_DESKTOP_MAX_HISTORY_RECORDS` or default `80`.
  - Desktop Resume/Stop/New Task behavior was not loosened.
- `apps/api/src/index.ts`
  - Added `GET /api/v1/codex-desktop/sessions/:id`.
  - Endpoint requires the same user-scoped Mini App/user context as the list endpoint.
- `apps/api/src/service.ts`
  - Added `getCodexDesktopSessionDetail(userId, sessionId)`.
  - Unknown sessions return `CODEX_DESKTOP_SESSION_NOT_FOUND`; no fake success path.
- `apps/miniapp/src/index.ts`
  - Desktop session page now fetches the detail endpoint and renders bounded history.
  - Unsupported Desktop actions remain disabled with reason code display.
- `apps/bot/src/handlers.ts`
  - Desktop session card explicitly points users to Mini App for bounded read-only history instead of dumping transcript text into Telegram.
- Tests updated in:
  - `packages/runtime-adapters/src/index.test.ts`
  - `apps/api/src/service.test.ts`
  - `apps/api/src/index.test.ts`
    - CI exposed a cleanup race in the transient API handoff test; fixed by tracking the scheduled close promise and avoiding double-close.
  - `apps/miniapp/src/index.test.ts`
  - `apps/bot/src/handlers.test.ts`

## Contract Evidence

- `raw/codex-contracts.txt` records:
  - `codex --help`
  - `codex resume --help`
  - `codex exec --help`
- CLI contract remains:
  - `codex exec` supports non-interactive start/new task flows.
  - `codex resume` is an interactive CLI command, not a Desktop control contract.
  - `codex app-server` is marked `[experimental]`; this does not prove a stable Desktop mutating contract.
- Desktop control remains default unsupported:
  - `CODEX_DESKTOP_CONTROL_UNSUPPORTED`
  - No Desktop Stop process-kill/window/lock-file workaround was added.
- Desktop visibility extension is read-only:
  - JSONL files are read only.
  - Projection is bounded and sanitized.
  - Full raw transcript export remains unsupported/not implemented.

## Build Evidence

- `raw/build.txt`: `pnpm build` passed.

## Verification Evidence

- `raw/lint.txt`: `pnpm lint` passed.
- `raw/typecheck.txt`: `pnpm typecheck` passed.
- `raw/test-unit.txt`: `pnpm test` passed.
- `raw/test-integration.txt`: `pnpm --filter @happytg/api test` passed.
- `raw/doctor.txt`: `pnpm happytg doctor` exited 0 with existing environment warning.
- `raw/verify.txt`: `pnpm happytg verify` exited 0 with same existing environment warning.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-05-03-codex-vision-history-complete` passed after adding `raw/build.txt`.
- `raw/fresh-verifier.txt`: separate verifier returned PASS with no blocking findings.

## CI Follow-up

- PR CI run `25275659748` failed once in `apps/api/src/index.test.ts` on `ERR_SERVER_NOT_RUNNING` in `startApiServer retries a transient HappyTG API handoff before classifying reuse`.
- Root cause: test cleanup race, not Desktop history production code.
- Minimal fix: track the scheduled `closeServer(occupied)` promise and avoid double-closing the transient test server.
- Local verification was rerun after this fix and raw outputs were refreshed.

## Warnings / Residuals

- Doctor/verify warn that Codex Responses websocket returned `403 Forbidden`, then Codex CLI fell back to HTTP. This is an environment/runtime warning, not a failing HappyTG check.
- Doctor/verify report existing HappyTG services already running on ports 3007, 4000, and 4100.
- Codex Desktop mutating control is still unsupported by default because no stable Desktop mutating contract was proven.
- Desktop history preview is intentionally bounded and sanitized; it is not a full raw transcript export.
