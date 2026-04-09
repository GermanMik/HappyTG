# Evidence Summary

## Root Cause

1. `packages/shared/src/index.ts`
   Windows-sensitive env lookup depended on exact env-key casing for `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `PATH`, `PATHEXT`, and `TELEGRAM_BOT_TOKEN`. That made first-run behavior unnecessarily brittle in Windows-like shells and reduced confidence in the `resolveHome()` / executable lookup path.

2. `packages/bootstrap/src/index.ts`
   Bootstrap diagnostics collapsed all `!available` Codex states into the same "not found" message. When the binary existed but startup failed, the operator still got a false missing-binary message instead of actionable runtime guidance.

3. GitHub-facing onboarding docs
   First-run documentation still leaned on raw path-style link labels and lacked compact visual/context cues for the most common first-start states surfaced in the logs.

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Windows home resolution honors env overrides for `~` and `~/...` without regressing cross-platform behavior. | `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Regression tests cover Windows-style env lookup and home expansion. | `packages/shared/src/index.test.ts`, `raw/test-unit.txt` |
| Windows Codex detection avoids PATH shim false negatives and mixed env-key casing issues. | `packages/shared/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Bootstrap guidance distinguishes missing Codex from unavailable Codex. | `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| Bot/token first-run behavior stays actionable without leaking secrets. | `packages/shared/src/index.ts`, `raw/test-unit.txt`, `raw/test-integration.txt` |
| GitHub-facing onboarding/readability improves with title links, visuals, and compact tables. | `README.md`, `docs/quickstart.md`, `docs/installation.md`, `docs/bootstrap-doctor.md`, `docs/troubleshooting.md`, `infra/README.md`, `CHANGELOG.md`, `docs/releases/0.2.0.md` |
| `pnpm typecheck`, `pnpm test`, and `pnpm build` pass. | `raw/typecheck.txt`, `raw/test-integration.txt`, `raw/build.txt` |

## Verification

- Targeted regression suites:
  - `pnpm --filter @happytg/shared test`
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm --filter @happytg/bot test`
- Repo gates:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`

## Outcomes

- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm test`: passed
- `pnpm build`: passed

## Residual Risk

- Windows behavior is validated through Windows-like env and shim scenarios plus full repo verification in this environment; no long-running interactive `pnpm dev` session was kept open on a real Windows host during this task.
