# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Warning-level follow-up returned by post-checks is aggregated into final installer `warnings` and `nextSteps`. | `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-unit.txt` |
| Repeated `CODEX_PATH_PENDING` messages from `setup`, `doctor`, and `verify` appear once in the final summary and structured result. | `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/cli.test.ts`; `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-unit.txt` |
| Final summary stays at `success-with-warnings`, keeps Telegram lookup warnings visible, and does not regress into recoverable failure for warning-only scenarios. | `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/cli.test.ts`; `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-unit.txt` |
| Interactive/plain-text/structured installer paths remain installer-native. | `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/cli.test.ts`; `packages/bootstrap/src/index.test.ts`; `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-unit.txt` |

## Root Cause

1. `packages/bootstrap/src/install/index.ts` recorded post-check output only into `postCheckReports` and per-step `detail`, using `report.findings` for step summaries and `report.planPreview` nowhere outside the loop.
2. Final installer rendering does not read `postCheckReports`. Both interactive final summary (`renderSummaryScreen`/`renderFinalScreen`) and plain-text `renderText(...)` read only top-level `InstallResult.warnings` and `InstallResult.nextSteps`.
3. Because warning-level post-check findings were never promoted into those top-level fields, the user could see `Run setup` / `Run doctor` / `Run verify` warnings during progress, but lose the PATH follow-up entirely on the final summary screen and JSON/text result.
4. Repeated `CODEX_PATH_PENDING` warnings from three post-check commands represented one environment follow-up, but there was no deduplication layer at the installer aggregation boundary.

## Verification

- Passed:
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm --filter @happytg/bootstrap typecheck`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm release:check --version 0.3.5`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-14-windows-postcheck-summary`

## Artifacts

- `packages/bootstrap/src/install/index.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `packages/bootstrap/src/cli.test.ts`
- `packages/bootstrap/src/index.test.ts`
- `apps/host-daemon/src/index.test.ts`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/build.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/typecheck-full.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/release-check.txt`
- `.agent/tasks/HTG-2026-04-14-windows-postcheck-summary/raw/task-validate.txt`
