# Evidence

Task: `HTG-2026-06-10-desktop-session-continuation`

## Spec Freeze

Scope was frozen before implementation in `spec.md`.

## Findings

- Existing Mini App `Resume` clicked `/codex/desktop-action`, which forwarded to API `resumeCodexDesktopSession`.
- Runtime app-server `resumeSession` used `thread/resume` and accepted no new user prompt.
- Existing app-server `turn/start` support was already proven for new Desktop tasks, so the narrow continuation fix is a dedicated existing-thread `turn/start` path.
- Desktop session history was rendered in one fixed order and Codex list sorting was hard-coded to newest updated first.

## Changes

- Added protocol action kind `codex_desktop_continue` and a dedicated continuation request type.
- Added policy and runtime category mappings for the new action.
- Added `CodexDesktopControlContract.continueSession`, adapter capability decoration, and app-server `turn/start` continuation for existing threads.
- Added API service method and route:
  - `POST /api/v1/codex-desktop/sessions/:id/continue`
  - preserves Mini App/user auth, policy evaluation, audit records, and serialized Desktop mutation execution.
- Added Mini App Desktop detail follow-up prompt form and `/codex/desktop-continue` route.
- Added Codex list sort controls and Desktop history oldest/newest controls.
- Added release metadata for `0.4.16`.

## Verification

- `raw/typecheck-targeted.txt`: targeted typecheck passed for `@happytg/protocol`, `@happytg/policy-engine`, `@happytg/runtime-adapters`, `@happytg/api`, and `@happytg/miniapp`.
- `raw/test-targeted.txt`: targeted tests passed for the same packages.
- `raw/lint.txt`: `pnpm lint` passed, 15/15 Turbo tasks.
- `raw/test-unit.txt`: `pnpm test` passed, 15/15 Turbo tasks.
- `raw/build.txt`: `pnpm build` passed, 15/15 Turbo tasks.
- `raw/doctor.txt`: `pnpm happytg doctor` exited 0 but reported HappyTG `FAIL` because this clean worktree has no `.env`/`TELEGRAM_BOT_TOKEN` and local ports 3001, 443, and 3000 are occupied by other services.
- `raw/test-integration.txt`: `pnpm happytg verify` exited 0 with the same local environment `FAIL` findings.
- `raw/release-check.txt`: `pnpm release:check --version 0.4.16` passed.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-06-10-desktop-session-continuation` passed.
- `raw/graphify-update.txt`: `graphify update .` refreshed root `graphify-out/` with no LLM backend.

## Critical Role Review

1. Product owner: previous sessions now have an explicit follow-up prompt path instead of relying on a confusing `Resume` button.
2. UX designer: the prompt lives on Desktop detail next to history/actions and gives inline feedback.
3. API engineer: `continue` is separate from `resume`, matching app-server `turn/start` versus `thread/resume`.
4. Runtime engineer: app-server unavailability still produces structured unavailable/unsupported errors.
5. Security reviewer: continuation remains user-scoped, policy-checked, audited, and serialized; no secrets were added to proof artifacts.
6. QA engineer: tests cover runtime continuation, API route forwarding, Mini App forwarding, unsupported paths, serialization, and sort order.
7. Release engineer: package versions, changelog, release notes, release validation, and proof evidence are present for `0.4.16`.
8. Maintainer: patch stays scoped to protocol/policy/runtime/API/Mini App and tests.
9. Operator: doctor/verify environment blockers are recorded truthfully instead of hidden as code failures.
10. Future agent: `Resume` remains a backend resume action; prompt-based continuation is `codex_desktop_continue`.
