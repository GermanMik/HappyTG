# Evidence

## Initial Findings

- `memory context --project` and `memory search` failed because the local `memory.cli` Python process could not start.
- `graphify query` failed because the local Graphify Python wrapper could not start.
- Source inspection shows the Desktop continue path is Mini App `/codex/desktop-continue` -> API `/api/v1/codex-desktop/sessions/:id/continue` -> runtime adapter `continueSession` -> Codex app-server `thread/resume` plus `turn/start`.
- The Mini App client currently disables the submit button, waits for the POST, then blindly calls `location.reload()`.
- Bot Desktop callbacks currently support project/session listing plus resume/stop; Mini App prompt submission does not create a bot message.
- Live diagnostics showed host-proxy could serve `/ready`, but Desktop sessions stayed `canContinue=false` while control requests timed out after `2500ms`.
- Running host-proxy outside sandbox was required for real app-server spawn; sandboxed proxy failed with `spawn EPERM`.

## Build Fix

- `/codex/desktop-continue` now returns `sessionHref` pointing to `/codex/desktop-session?id=<id>&historyOrder=newest-first`, preserving `userId`.
- The Mini App submit handler now shows accepted state, resets the form, restores the submit control, and navigates to `sessionHref` instead of blindly reloading.
- Runtime Desktop control timeout default was raised to `10_000ms`, matching the host-proxy request window.
- Mini App Desktop session list fetch now gets a `10_000ms` default budget unless the operator explicitly overrides `HAPPYTG_MINIAPP_CODEX_FETCH_TIMEOUT_MS`; widened Desktop lists still keep a minimum `10_000ms` budget.

## Raw Artifacts

- `raw/test-miniapp-final.txt`
- `raw/test-runtime-adapters.txt`
- `raw/typecheck-miniapp-final.txt` and `raw/typecheck-runtime-adapters.txt` were superseded by canonical `raw/lint.txt` because the package lint scripts are `tsc --noEmit`.
- `raw/build.txt`
- `raw/lint.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/current-live-smoke-3.txt`
- `raw/current-live-smoke-jsonl-confirmation.txt`
- `raw/release-check-0.4.30.txt`
- `raw/task-validate.txt`

## Verification

- `tsx --test apps/miniapp/src/index.test.ts` passed: 27 tests, 0 failed.
- `tsx --test packages/runtime-adapters/src/index.test.ts` passed: 28 tests, 0 failed.
- `corepack pnpm lint` passed: 15 packages, 15 successful.
- `corepack pnpm build` passed: 15 packages, 15 successful.
- `tsx packages/bootstrap/src/cli.ts task validate --repo . --task HTG-2026-06-19-desktop-continue-live-fix` passed.
- `node scripts/release/validate-release.mjs --version 0.4.30` passed.
- Live smoke used current-source Mini App on `3019`, current-source API on `4021`, and host-proxy on `4318`; POST `/codex/desktop-continue?userId=usr_1` returned `action=continue`, `resultSessionStatus=active`, and `sessionHref=/codex/desktop-session?id=019ed3d8-904b-7eb0-97bd-1c10f09df378&historyOrder=newest-first&userId=usr_1`.
- JSONL confirmation found the test prompt in old Desktop session `019ed3d8-904b-7eb0-97bd-1c10f09df378` at `2026-06-19T17:40:32Z`.
