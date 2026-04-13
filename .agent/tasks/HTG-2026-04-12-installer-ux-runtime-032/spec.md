# Task Spec

- Task ID: HTG-2026-04-12-installer-ux-runtime-032
- Title: Installer TUI UX/runtime fixes for 0.3.2
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The existing installer flow inside `packages/bootstrap` still has two user-facing gaps after the 0.3.1 resilience work. First, the Telegram bot token field accepts pasted input but the retro TUI gives no trustworthy visual confirmation of what was captured; users cannot distinguish empty state, partial paste, or saved value, and the current masking helper is summary-oriented rather than field-rendering-oriented. Second, the final installer UX and structured result model still collapse warnings and failures into a single `pass|warn|fail` view, which produces contradictory states such as “Install flow is complete” alongside `HappyTG install [FAIL]` and can leave the interactive flow on a dead-end close screen when Telegram lookup warns or required data is incomplete. The fix must stay inside the current bootstrap engine, keep Telegram-first onboarding, preserve Linux/macOS/Windows behavior, and prepare the release as `0.3.2`.

## Acceptance Criteria

1. Telegram token field shows masked preview while persisting raw secret only.
2. Installer final/result status is normalized across success, warnings, recoverable failures, and fatal failures without contradictory UI or dead-end close behavior.
3. Interactive and structured installer paths remain installer-native, recoverable, and consistent for warning-only Telegram lookup failures and invalid incomplete data.
4. Release metadata and proof bundle are updated for 0.3.2 with required verification evidence.

## Constraints

- Runtime: Codex CLI
- Builder/verifier separation is required; the verifier must not edit production code.
- Extend the existing `packages/bootstrap` installer only; do not introduce a parallel standalone installer or a non-bootstrap onboarding flow.
- Telegram token masking must be implemented through a dedicated display/helper layer near TUI form rendering, with an explicit distinction between raw secret state and rendered masked value.
- Final summary/failure rendering must be driven by a normalized installer result/status model that can express success, success-with-warnings, recoverable-failure, and fatal-failure.
- Interactive close/back/retry behavior must stay inside the existing event/state model; do not add platform-specific hacks or ad hoc top-level branching.
- Persisted draft/state, stdout/stderr summaries, and structured output must never expose the full Telegram bot token.
- `pnpm happytg setup`, `pnpm happytg doctor`, `pnpm happytg repair`, and `pnpm happytg verify` must remain compatible.
- Repository architecture invariants remain intact: Telegram is not an internal transport layer; policy evaluation still precedes approval evaluation; serialized mutation handling is not weakened; heavy initialization stays lazy/cache-aware.
- If release metadata is touched, workspace/package versions, `CHANGELOG.md`, and `docs/releases/0.3.2.md` must align to `0.3.2`, and release validation must pass.

## Verification Plan

- Unit: extend installer/runtime/CLI tests for token masking, paste/edit/backspace preservation, persisted raw token state, short-token masking, final screen close behavior, warning-only Telegram lookup status, incomplete-data runtime handling, and structured JSON/status consistency.
- Integration: run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm happytg doctor`, `pnpm happytg verify`, and `pnpm release:check --version 0.3.2` because release metadata is expected to change.
- Manual: inspect the interactive TUI rendering helpers and final screen transitions to confirm `ENTER close` resolves the screen and warning-only runs are rendered as non-contradictory installer-native completion.
- Evidence files to produce: raw `build.txt`, `test-unit.txt`, `test-integration.txt`, `lint.txt`, plus `typecheck.txt`, `doctor.txt`, `verify.txt`, and `release-check.txt` under `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/`.
- Proof loop order: init, freeze/spec, build, evidence, fresh verify, minimal fix, fresh verify, complete.
