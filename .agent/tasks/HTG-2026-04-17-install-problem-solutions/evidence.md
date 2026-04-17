# HTG-2026-04-17-install-problem-solutions

## Reproduced Scoped Issue

- Installer finalization items could only render a single `message` string, so problem statement and remediation guidance were merged into one line.
- That made `pnpm happytg install` summaries less scannable and prevented install JSON / plain-text / TUI from sharing a structured "problem + solution bullets" contract.
- Classification: product bug in installer UX / finalization modeling.

## Minimal Fix

- Extended `AutomationItem` with optional `solutions`.
- Updated legacy preview helpers so structured items can still feed old preview consumers without losing the separate remediation points.
- Updated CLI and TUI install renderers to show the problem as the main bullet and remediation as indented follow-up bullets.
- Updated onboarding/finalization builders so relevant warnings, blocked items, and conflicts emit separate `message` and `solutions` fields instead of stuffing both into one sentence.
- Updated regression coverage across bootstrap CLI/runtime/install/index tests.

## Verification

- `pnpm --filter @happytg/bootstrap typecheck` -> pass
- `pnpm --filter @happytg/bootstrap test` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> pass

Raw artifacts:

- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`
- `raw/task-validate.txt`

## Scope Notes

- No release/publish flow was touched.
- No live `pnpm happytg install` run against the working repo was used as primary evidence because that path mutates local install state and `.env`; the scoped behavior is covered by fresh runtime and renderer tests in `@happytg/bootstrap`.

## Fresh Verifier Pass

- Independent verifier role requested after the build loop.
- First verifier confirmed the scoped code change and reported two close-out gaps: unfinished proof-bundle metadata and missing direct TUI warning-item `solutions` coverage.
- Those gaps were resolved by finalizing the bundle metadata and extending `packages/bootstrap/src/install.test.ts` to assert warning-item remediation bullets directly.
- Second verifier (`task-verifier`, agent `019d9c07-eab2-77f3-b31e-92d78bdd8595`) reported no findings and accepted the scoped task after a read-only bootstrap typecheck/test pass.
- Final verifier outcome is recorded in `verdict.json`.
