# Evidence Summary

## Root Cause

1. `packages/shared/src/index.ts`
   Windows path helpers treated `Path` / `PATH` and `PATHEXT` / `pathext` as if one casing variant should win. In mixed PowerShell/Node environments that can leave an empty or stale `Path` entry taking precedence over the usable `PATH`, so `resolveExecutable()` and `normalizeSpawnEnv()` drop the real search path and Codex shim extensions. That is the runtime/bootstrap false-negative bug.

2. `packages/runtime-adapters/src/index.test.ts` and `packages/bootstrap/src/index.test.ts`
   The Windows shim tests wrote `.cmd` files containing POSIX shell syntax. Those files are runnable on Unix when given a shebang, but they are not valid Windows batch shims, so the failing Windows tests were also reproducing an invalid harness rather than a real npm/pnpm `codex.cmd` scenario.

## Changed Files

- `packages/shared/src/index.ts`
- `packages/shared/src/index.test.ts`
- `packages/runtime-adapters/src/index.test.ts`
- `packages/bootstrap/src/index.test.ts`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| `checkCodexReadiness()` resolves and executes Windows Codex shims through mixed-case `PATH` / `Path` and `PATHEXT` / `pathext` handling. | `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`, `packages/runtime-adapters/src/index.test.ts`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-integration.txt` |
| Missing guidance is preserved for truly missing Codex binaries, while Windows shim scenarios no longer false-negative. | `packages/runtime-adapters/src/index.test.ts`, `packages/bootstrap/src/index.test.ts`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-integration.txt` |
| Windows `.cmd` regression tests use a realistic harness on Windows and still run cross-platform. | `packages/runtime-adapters/src/index.test.ts`, `packages/bootstrap/src/index.test.ts`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-unit.txt` |
| Bootstrap/doctor coverage proves a found Windows Codex shim does not surface `CODEX_MISSING`. | `packages/bootstrap/src/index.test.ts`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-integration.txt` |
| `pnpm typecheck`, `pnpm test`, and `pnpm build` pass. | `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/typecheck.txt`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-integration.txt`, `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/build.txt` |

## Verification

- Targeted regressions:
  - `pnpm --filter @happytg/shared test`
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/bootstrap test`
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

- No live Windows `pnpm dev` session was held open in this environment. The runtime/bootstrap behavior is covered by Windows-like regression tests, including duplicate `Path` / `PATH` handling and real batch-shim behavior on Windows hosts.
