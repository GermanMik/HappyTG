# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Telegram token field shows masked preview while persisting raw secret only. | `packages/bootstrap/src/install/tui.ts`; `packages/bootstrap/src/install/telegram.ts`; `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/install.test.ts`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/build.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-integration.txt` |
| Installer final/result status is normalized across success, warnings, recoverable failures, and fatal failures without contradictory UI or dead-end close behavior. | `packages/bootstrap/src/install/status.ts`; `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install/tui.ts`; `packages/bootstrap/src/cli.ts`; `packages/bootstrap/src/cli.test.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/build.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-integration.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/typecheck.txt` |
| Interactive and structured installer paths remain installer-native, recoverable, and consistent for warning-only Telegram lookup failures and invalid incomplete data. | `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install/telegram.ts`; `packages/bootstrap/src/install/status.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/install.test.ts`; `packages/bootstrap/src/cli.ts`; `packages/bootstrap/src/cli.test.ts`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-integration.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/doctor.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/verify.txt` |
| Release metadata and proof bundle are updated for 0.3.2 with required verification evidence. | `CHANGELOG.md`; `README.md`; `docs/releases/0.3.2.md`; `package.json`; `apps/*/package.json`; `packages/*/package.json`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/spec.md`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/verdict.json`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/problems.md`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/lint.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/typecheck.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-integration.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/release-check.txt`; `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/bundle-validate.txt` |

## Build Notes

- Commands executed: `pnpm --filter @happytg/bootstrap build`; `pnpm --filter @happytg/bootstrap test`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm happytg doctor`; `pnpm happytg verify`; `pnpm release:check --version 0.3.2`.
- Key outputs: bootstrap build passed; bootstrap package tests passed; workspace lint/typecheck/test passed; release validation passed for `0.3.2`.
- Environment note: `pnpm happytg doctor` and `pnpm happytg verify` still report the expected local checkout issues (`.env` missing, `TELEGRAM_BOT_TOKEN` missing, Redis not running). Those are workspace-environment findings, not regressions introduced by the installer changes.

## Residual Risk

- The Windows-like Codex shim doctor test behaved flakily once during local reruns, but the final bootstrap package pass and final monorepo `pnpm test` pass both succeeded without code changes to that area.
- Interactive TUI behavior is covered through reducer/render tests rather than a full pseudo-terminal end-to-end session, so terminal-specific rendering quirks remain a residual manual-risk surface.

## Artifacts

- `packages/bootstrap/src/cli.ts`
- `packages/bootstrap/src/cli.test.ts`
- `packages/bootstrap/src/install/index.ts`
- `packages/bootstrap/src/install/status.ts`
- `packages/bootstrap/src/install/telegram.ts`
- `packages/bootstrap/src/install/tui.ts`
- `packages/bootstrap/src/install/types.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `packages/bootstrap/src/install.test.ts`
- `CHANGELOG.md`
- `README.md`
- `docs/releases/0.3.2.md`
- `package.json`
- `apps/api/package.json`
- `apps/bot/package.json`
- `apps/host-daemon/package.json`
- `apps/miniapp/package.json`
- `apps/worker/package.json`
- `packages/approval-engine/package.json`
- `packages/bootstrap/package.json`
- `packages/hooks/package.json`
- `packages/policy-engine/package.json`
- `packages/protocol/package.json`
- `packages/repo-proof/package.json`
- `packages/runtime-adapters/package.json`
- `packages/shared/package.json`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/build.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/doctor.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/verify.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/release-check.txt`
- `.agent/tasks/HTG-2026-04-12-installer-ux-runtime-032/raw/bundle-validate.txt`
