# Evidence

## Scope

- Task ID: `HTG-2026-04-19-installer-progress-bar`
- Area: `packages/bootstrap` installer progress TUI
- Objective: add an installer-wide progress bar so long-running steps such as `Resolve planned ports` no longer look stalled

## Root Causes Confirmed

1. `packages/bootstrap/src/install/tui.ts` rendered only a list of step labels and step-local detail. The user could see which step was active, but not how much of the install flow had already completed.
2. Long-running components already reuse the same progress surface, so the missing signal was not orchestration state. The missing signal was an aggregate progress indicator derived from the existing step statuses.

## Implementation

- Added `summarizeStepProgress()` in `packages/bootstrap/src/install/tui.ts` to count only terminal step states: `passed`, `warn`, `failed`, and `skipped`.
- Added `renderStepProgressBar()` in `packages/bootstrap/src/install/tui.ts` to render an ASCII-safe bar in the form `[###-------]`.
- Updated `renderProgressScreen()` to show the shared aggregate line `N/total steps complete` above the step list.
- Kept installer sequencing and step semantics unchanged: `running` stays incomplete, and the port-preflight/product behavior is untouched.
- Added renderer regression coverage in `packages/bootstrap/src/install.test.ts`.
- Extended the interactive port-preflight runtime regression in `packages/bootstrap/src/install.runtime.test.ts` to assert that the rerun screen includes the aggregate bar.

## Verification

Commands and raw outputs are stored under `.agent/tasks/HTG-2026-04-19-installer-progress-bar/raw/`.

### Build

- Command: `pnpm --filter @happytg/bootstrap build`
- Result: passed
- Raw: `raw/build.txt`

### Lint

- Command: `pnpm --filter @happytg/bootstrap lint`
- Result: passed
- Raw: `raw/lint.txt`

### Unit

- Command: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern progress`
- Result: passed, 18/18 tests
- Raw: `raw/test-unit.txt`

### Integration

- Command: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern progress`
- Result: passed, 44/44 tests
- Raw: `raw/test-integration.txt`

### Bundle

- Command: `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-progress-bar`
- Result: passed
- Raw: `raw/task-validate.txt`

## Notes

- The bar is shared across installer components because it is rendered at the common TUI layer, not implemented as a port-preflight-only special case.
- The indicator is step-count based, not time-based. A long-running single step can still hold the same percentage for a while, but the user now sees that the installer is partway through the overall flow rather than frozen.
