# Task Spec

- Task ID: HTG-2026-04-14-windows-postcheck-summary
- Title: Aggregate installer post-check warnings into final summary
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The installer's Windows post-check flow now correctly leaves `CODEX_PATH_PENDING` at warning severity, but the final summary still under-reports follow-up actions. `setup`, `doctor`, and `verify` can each return the same warning-level `report.findings` and `planPreview`, and those messages appear in the step-local progress details, yet the final installer summary only renders `InstallResult.warnings` and `InstallResult.nextSteps`. Today the install runtime does not promote post-check warning findings or plan items into those top-level summary fields, so the interactive final screen, plain-text output, and structured install result can claim "complete with warnings" while omitting the real PATH follow-up. The fix must stay inside the existing bootstrap installer flow, preserve success-with-warnings severity, and dedupe repeated post-check follow-up text.

## Acceptance Criteria

1. Warning-level follow-up returned by post-checks is aggregated into final installer `warnings` and `nextSteps`.
2. Repeated `CODEX_PATH_PENDING` messages from `setup`, `doctor`, and `verify` appear once in the final summary and structured result.
3. The final summary still reports `success-with-warnings`, keeps Telegram lookup warnings visible, and does not regress into recoverable failure for warning-only scenarios.
4. Interactive summary rendering and plain-text/structured install output remain installer-native and continue to use the existing bootstrap engine paths.

## Constraints

- Runtime: Codex CLI.
- Keep the diff minimal and avoid unrelated refactors.
- Do not add a parallel installer path or bypass bootstrap reports.
- Preserve Linux/macOS/Windows compatibility and existing `pnpm happytg setup`, `doctor`, `repair`, and `verify` entrypoints.
- Keep step-local rendering intact while fixing install-result aggregation and final-summary visibility.

## Verification Plan

- Extend bootstrap install runtime tests for mixed Telegram plus Codex PATH warnings, repeated post-check dedupe, and preserved `success-with-warnings` outcome.
- Add/install text rendering coverage for final install summaries that include deduped warnings and next steps.
- Run targeted bootstrap tests and capture outputs under this task bundle.
