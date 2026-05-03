# HTG-2026-05-03-api-startup-test-stabilize Spec

Status: frozen before code changes

## Trigger

Release workflow run `25278110721` for `v0.4.11` failed in `pnpm test`.

The failing test was `startApiServer retries a transient HappyTG API handoff before classifying reuse` in `apps/api/src/index.test.ts`.

## Scope

- Stabilize the test harness for the transient HappyTG API handoff case.
- Keep production startup behavior unchanged unless evidence proves a production defect.
- Preserve the release artifact created by `HTG-2026-05-03-ux-10-role-prompt`.
- Re-run focused and broad checks before retrying the release workflow.

## Non-Goals

- No API runtime refactor.
- No port conflict policy change.
- No unrelated UI, bot, Mini App, installer, or release metadata change.

## Acceptance Criteria

- The handoff test deterministically exercises the intended path: initial `EADDRINUSE`, service detected as HappyTG API, transient service disappears, API binds to the same port.
- No fake success: the test must still assert `{ status: "listening", port }`.
- `pnpm --filter @happytg/api test` passes locally.
- `pnpm test` passes locally.
- Release workflow for `v0.4.11` is retried after merge and passes, or any remaining blocker is recorded with evidence.
