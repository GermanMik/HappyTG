# Evidence Summary

## Root Cause

- The old missing-Codex prompt was generic and did not inspect the global npm installation layout, so project checks could not tell the user whether Codex was merely off `PATH` or only partially installed.
- `checkCodexReadiness()` also allowed an unresolved bare Windows command to go through `shell: true`, which made the missing/not-found outcome depend on the host shell instead of producing a deterministic missing result.

## Changed Files

- `packages/runtime-adapters/src/index.ts`
- `packages/runtime-adapters/src/index.test.ts`
- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/index.test.ts`
- `packages/bootstrap/src/cli.test.ts`
- `apps/host-daemon/src/index.test.ts`
- `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/build.txt`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Missing-Codex guidance mentions PATH and escalates to reinstall + PATH update when still absent | `codexCliMissingMessage()` now says Codex is not on the current shell PATH yet, advises checking the global npm prefix and wrapper files, and falls back to reinstall + PATH update guidance. Runtime message coverage is asserted in `packages/runtime-adapters/src/index.test.ts`. |
| Bootstrap diagnostics inspect the global npm prefix and Codex wrapper files to distinguish PATH issues from missing/partial install | `detectCodexInstallCheck()` in `packages/bootstrap/src/index.ts` runs `npm prefix -g`, inspects candidate `codex` wrapper files, and `codexMissingMessage()` selects PATH-issue vs partial-install wording. Covered by the two new bootstrap doctor tests. |
| Host-daemon/runtime missing guidance stays consistent | `packages/bootstrap/src/cli.test.ts` and `apps/host-daemon/src/index.test.ts` now reference the shared runtime missing message helper instead of stale hard-coded copy. |
| Regression tests cover PATH issue and missing/partial install cases | Added/updated tests in `packages/runtime-adapters/src/index.test.ts` and `packages/bootstrap/src/index.test.ts` for Windows-like `Path`/`PATHEXT`, missing bare command handling, npm-prefix wrapper detection, and reinstall fallback. |
| `pnpm typecheck`, `pnpm test`, and `pnpm build` pass | Recorded in raw artifacts under `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/`. |

## Verification

- `pnpm lint` -> passed
- `pnpm typecheck` -> passed
- `pnpm test` -> passed
- `pnpm build` -> passed
- No separate integration-only test target exists for this change, so `raw/test-integration.txt` records that the repo-wide test suite was used instead.

## Outcomes

- Missing-Codex checks now say that Codex is not on the current shell PATH yet and tell the user to inspect the global npm prefix/wrapper files before reinstalling.
- Bootstrap doctor logic can now distinguish:
  - Codex wrapper exists under npm prefix -> likely PATH issue
  - Codex wrapper missing under npm prefix -> likely missing or partial install
- Windows-like missing command handling is deterministic because unresolved bare commands no longer rely on shell fallback.
- Live `pnpm happytg doctor` / `pnpm happytg verify` was not run in this local environment; bootstrap/runtime behavior is covered by focused regression tests instead.
