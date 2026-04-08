# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Runtime adapters use a cross-platform Codex harness and package tests pass on Windows/macOS/Linux without POSIX-only test scripts. | `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-unit.txt` |
| Bootstrap reports missing config and Codex smoke warnings as warn, uses PATH-based Git detection, and preserves machine-readable report JSON. | `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `packages/shared/src/index.ts`, `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-integration.txt` |
| User-facing first-run messaging is concise and actionable for missing Codex CLI, unpaired host, and occupied miniapp port; verbose details stay in doctor/JSON diagnostics. | `packages/runtime-adapters/src/index.ts`, `packages/bootstrap/src/cli.ts`, `apps/host-daemon/src/index.ts`, `apps/miniapp/src/index.ts`, `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-integration.txt` |
| CLI bootstrap output is structured and compact, and at least one user-facing progress indicator is shown without changing existing APIs unnecessarily. | `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/cli.test.ts`, `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts` |
| Miniapp handles port conflicts without an unhandled stack trace and host-daemon suppresses repeated expected first-run noise. | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `apps/host-daemon/src/index.ts`, `apps/host-daemon/src/index.test.ts` |
| Tests cover the cross-platform runtime harness, bootstrap warning expectations, diagnostics/text rendering split, and reduced-noise startup or miniapp port-conflict handling. | `packages/shared/src/index.test.ts`, `packages/runtime-adapters/src/index.test.ts`, `packages/bootstrap/src/index.test.ts`, `packages/bootstrap/src/cli.test.ts`, `apps/miniapp/src/index.test.ts`, `apps/host-daemon/src/index.test.ts` |

## Build Notes

- Commands executed: `pnpm --filter @happytg/shared test`, `pnpm --filter @happytg/runtime-adapters test`, `pnpm --filter @happytg/bootstrap test`, `pnpm --filter @happytg/miniapp test`, `pnpm --filter @happytg/host-daemon test`, `pnpm typecheck`, `pnpm test`, `pnpm happytg doctor`, `pnpm happytg verify`, `pnpm build`, `pnpm lint`
- Key outputs:
- targeted package tests passed
- `pnpm typecheck` passed across 13 packages
- `pnpm test` passed across 13 packages
- `pnpm build` passed across 13 packages
- bootstrap plain-text output stayed compact while detailed diagnostics remained in JSON/doctor paths

## Residual Risk

- Host-daemon reduced-noise behavior is covered by unit tests and code inspection; no full live daemon loop was run against a real API during this task.

| Criterion | Evidence |
| --- | --- |
| Cross-platform runtime harness and passing package tests | `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Bootstrap warning/status expectations and PATH-based Git detection | `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/cli.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Short actionable onboarding messages and diagnostics split | `packages/runtime-adapters/src/index.ts`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/cli.ts`, `apps/host-daemon/src/index.ts`, `apps/miniapp/src/index.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Structured CLI output and proof-loop progress indicator | `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/cli.test.ts`, `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts` |
| Miniapp port-conflict handling and reduced daemon noise | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `apps/host-daemon/src/index.ts`, `apps/host-daemon/src/index.test.ts`, `raw/test-unit.txt` |
| Regression coverage for startup/rendering changes | `packages/runtime-adapters/src/index.test.ts`, `packages/bootstrap/src/index.test.ts`, `packages/bootstrap/src/cli.test.ts`, `packages/shared/src/index.test.ts`, `apps/miniapp/src/index.test.ts`, `apps/host-daemon/src/index.test.ts` |

## Build Notes

- Commands executed:
- `pnpm --filter @happytg/runtime-adapters test`
- `pnpm --filter @happytg/bootstrap test`
- `pnpm --filter @happytg/shared test`
- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/host-daemon test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg doctor --json`

- Key outputs:
- `@happytg/runtime-adapters`, `@happytg/bootstrap`, `@happytg/shared`, `@happytg/miniapp`, and `@happytg/host-daemon` package tests passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and full `pnpm test` passed across the monorepo.
- `pnpm happytg doctor` now renders compact summary/findings/next-steps sections, while `--json` exposes detailed Git/Codex diagnostics.
- Miniapp task/session pages render proof progress and status badges; startup returns an actionable message on `EADDRINUSE`.
- Host daemon startup now suppresses repeated first-run notices and prefers pairing guidance before Codex readiness checks on a fresh host.

## Residual Risk

- `pnpm dev` itself was not run end-to-end in this environment, so first-run behavior is verified through targeted startup helpers/tests and repo-level suites rather than an interactive long-lived dev session.
