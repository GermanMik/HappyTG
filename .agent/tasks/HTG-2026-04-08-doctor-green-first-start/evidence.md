# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Bootstrap doctor/status/verify stay green when Codex smoke succeeds and stderr contains only known benign Codex internal state warnings; raw stderr remains available in --json diagnostics. | `packages/runtime-adapters/src/index.ts`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `.agent/tasks/HTG-2026-04-08-doctor-green-first-start/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-08-doctor-green-first-start/raw/test-integration.txt` |
| Real Codex smoke failures and unknown stderr still surface as actionable findings. | `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `packages/bootstrap/src/index.test.ts` |
| Repository launch/quickstart docs include concrete first-start commands, including install, doctor, control-plane start, pairing, and daemon start. | `README.md`, `docs/quickstart.md`, `docs/installation.md`, `docs/bootstrap-doctor.md` |
| Tests cover benign-warning filtering and preserve existing diagnostics separation behavior. | `packages/bootstrap/src/index.test.ts`, `.agent/tasks/HTG-2026-04-08-doctor-green-first-start/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-08-doctor-green-first-start/raw/test-integration.txt` |

## Build Notes

- Commands executed: `pnpm --filter @happytg/runtime-adapters test`, `pnpm --filter @happytg/bootstrap test`, `pnpm happytg doctor`, `pnpm happytg doctor --json`, `pnpm happytg verify`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`
- Key outputs:
- local `doctor` and `verify` became `PASS`
- `doctor --json` still preserved raw Codex stderr in `reportJson.codex.smokeError`
- repo-level `typecheck`, `test`, and `build` remained green

## Residual Risk

- Benign-warning filtering is intentionally allowlist-based. New unknown Codex stderr lines will still surface as warnings until explicitly reviewed and classified.
