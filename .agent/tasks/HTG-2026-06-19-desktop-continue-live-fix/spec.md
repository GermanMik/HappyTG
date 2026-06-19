# HTG-2026-06-19-desktop-continue-live-fix

## Problem

When an operator continues an existing Codex Desktop session from the Mini App, the submit flow can look blocked and the UI can appear unchanged after the prompt is sent. The expected behavior is that the prompt is accepted through the existing Codex Desktop control path, the operator gets immediate visible feedback, and the app navigates to the exact session detail where the new turn can be observed.

## Scope

- Fix the Mini App Desktop continuation submit flow.
- Fix the runtime readiness window that marks old Desktop sessions unsupported while Codex app-server/host-proxy is still warming.
- Preserve the existing API/runtime Desktop continuation contract: `/api/v1/codex-desktop/sessions/:id/continue` still calls the Codex Desktop adapter `continueSession` path.
- Keep `Resume`, `Continue`, and `New Task` separate actions.
- Preserve direct `userId` context in continuation success navigation.
- Add focused regression coverage.
- Verify with a live smoke test against one old Desktop session after implementation.

## Acceptance Criteria

1. `/codex/desktop-continue?userId=...` returns the Desktop control result plus a concrete `sessionHref`.
2. The success `sessionHref` points at `/codex/desktop-session?id=<session>&historyOrder=newest-first` and preserves `userId`.
3. The Mini App client clears the prompt, restores control to the form, shows an accepted state, and navigates to the concrete session detail instead of doing a blind reload.
4. The existing Desktop continue POST still forwards the prompt to `/api/v1/codex-desktop/sessions/:id/continue`.
5. Old Desktop sessions remain controllable through host-proxy after app-server warmup instead of being disabled by a too-short control timeout.
6. Focused Mini App/runtime tests, typecheck/lint/build, task validation, and live smoke evidence are recorded under `raw/`.

## Constraints

- Do not weaken policy or approval behavior.
- Do not turn Telegram into the internal transport for Desktop agent events.
- Do not alter unrelated stash content.
- Keep changes minimal and reviewable.

## Verification Plan

- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/runtime-adapters test`
- `pnpm --filter @happytg/miniapp typecheck`
- `pnpm --filter @happytg/runtime-adapters typecheck`
- `pnpm --filter @happytg/miniapp lint`
- `pnpm --filter @happytg/runtime-adapters lint`
- `pnpm --filter @happytg/miniapp build`
- `pnpm --filter @happytg/runtime-adapters build`
- `pnpm happytg task validate --repo . --task HTG-2026-06-19-desktop-continue-live-fix`
- Live smoke: submit a harmless test prompt through the app path to an old Codex Desktop session and verify a new user turn appears in session detail/history.

## Phase Status

- `init`: complete
- `freeze/spec`: complete
- `build`: complete
- `evidence`: complete
- `fresh verify`: complete
- `minimal fix`: complete
- `fresh verify`: complete
- `complete`: complete
