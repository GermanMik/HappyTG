# Evidence

## Scope

- Task ID: `HTG-2026-04-19-installer-final-summary-exit`
- Area: `packages/bootstrap` installer finalization and TUI final-screen exit
- Objective: make pairing completion output truthful for reuse/refresh/manual-fallback branches and ensure the interactive installer exits after `ENTER close`

## Root Causes Confirmed

1. `packages/bootstrap/src/install/index.ts` only rewrote pairing finalization for `reuse-existing-host` and `auto-requested`, but the `manual-fallback` branch preserved the bootstrap post-check placeholder pairing items. That left the live final summary vulnerable to stale/manual pairing guidance even after the installer had already evaluated the backend-probed pairing state.
2. `packages/bootstrap/src/install/tui.ts` removed keypress listeners and raw mode, but it did not explicitly restore stdin lifecycle. The final screen therefore lacked a deterministic guarantee that the interactive input stream was paused again after `ENTER close`, which is the missing completion contract behind the observed “screen stays open / prompt does not return” behavior.

## Implementation

- Added manual-fallback formatter helpers in `packages/bootstrap/src/install/index.ts` so fallback branches replace placeholder `request-pair-code` / `complete-pairing` items with truthful manual guidance and a conditional `/pair CODE` handoff.
- Kept successful existing-host reuse and auto-refresh behavior unchanged except for sharing the finalization model with the new fallback wording.
- Updated `pairingPending` detection so background guidance still stays “after pairing” whenever manual pairing remains unresolved.
- Added explicit `stdin.resume()` / `stdin.pause()` lifecycle management in `packages/bootstrap/src/install/tui.ts` around the shared keypress loop.
- Added deterministic regression coverage for:
  - existing-host refresh;
  - existing-host reuse;
  - existing-host manual fallback;
  - semantic dedupe with request-failed fallback wording;
  - running-stack reuse with request-failed fallback wording;
  - final-screen close on Enter;
  - interactive installer releasing stdin after the final summary;
  - `cli.ts` install-wrapper pass-through so the CLI layer preserves the installer result contract and `tuiHandled`.

## Verification

Commands and raw outputs are stored under `.agent/tasks/HTG-2026-04-19-installer-final-summary-exit/raw/`.

### Build

- Command: `pnpm --filter @happytg/bootstrap run build`
- Result: passed
- Raw: `raw/build.txt`

### Typecheck

- Command: `pnpm --filter @happytg/bootstrap run typecheck`
- Result: passed
- Raw: `raw/typecheck.txt`

### Lint

- Command: `pnpm --filter @happytg/bootstrap run lint`
- Result: passed
- Raw: `raw/lint.txt`

### Targeted Regressions

- Commands:
  - `pnpm --filter @happytg/bootstrap exec tsx --test --test-name-pattern "delegates install requests through the CLI wrapper|releases stdin after ENTER closes the final summary|waitForEnter resolves|does not render the same final screen twice" src/cli.test.ts src/install.test.ts src/install.runtime.test.ts`
  - `pnpm --filter @happytg/bootstrap exec tsx --test --test-name-pattern "refreshes the pairing code automatically|reuses an already paired existing host|renders an honest manual fallback|semantically dedupes repeated setup next steps|removes contradictory start commands" src/install.runtime.test.ts`
- Result: passed, 9/9 tests
- Raw: `raw/test-integration.txt`

### Full Bootstrap Suite

- Command: `pnpm --filter @happytg/bootstrap run test`
- Result: passed, 81/81 tests
- Raw: `raw/test-unit.txt`

## Notes

- Confirmation after the fix is deterministic via the full interactive installer runtime harness and TUI regression tests, not a destructive rerun against the operator’s live local environment.
- `pnpm happytg task status --repo . --task HTG-2026-04-19-installer-final-summary-exit` and `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-final-summary-exit` now both report `Phase: complete` and `Verification: passed`.
- A dedicated `cli.ts` wrapper regression now exists, so proof no longer relies solely on code inspection for the CLI layer.
