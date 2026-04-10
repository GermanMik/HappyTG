# Evidence Summary

## Root Cause

- `checkCodexReadiness()` was correctly finding `codex.cmd`, but `runCommand()` then passed the resolved shim path to `spawn(..., { shell: true })` without shell-quoting the command path.
- When the resolved shim lived under a directory with spaces, the shell split the path before execution. The repro artifact in `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/build.txt` shows the unquoted invocation failing with `No such file or directory`, while the quoted invocation succeeds.
- This is why Windows readiness returned `available: false` even though `resolveExecutable()` had already found the `.cmd` shim.

## Changed Files

- `packages/runtime-adapters/src/index.ts`
- `packages/runtime-adapters/src/index.test.ts`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| `checkCodexReadiness()` succeeds for Windows `.cmd` shims found through `Path`, lowercase `path` / `pathext`, and duplicate-cased `PATH` / `Path` plus `PATHEXT` / `pathext`. | `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/index.test.ts`, `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-unit.txt` |
| True missing-command behavior remains intact. | `packages/runtime-adapters/src/index.test.ts`, `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-unit.txt` |
| Benign smoke warning filtering remains unchanged. | `packages/runtime-adapters/src/index.test.ts`, `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-unit.txt` |
| The fix is minimal and isolated to the Windows `.cmd` shell execution path. | `packages/runtime-adapters/src/index.ts`, `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/build.txt` |

## Verification

- Reproduced the shell-path root cause with:
  - `node` inline repro writing a `.cmd` shim under `dir with space`
- Passed:
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm typecheck`
  - `pnpm lint`
- Not run:
  - `pnpm --filter @happytg/shared test` because shared code was unchanged
  - Integration-specific checks; see `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-integration.txt`

## Residual Risk

- The regression fix is covered by host-independent tests that force the `.cmd` shim to live in a spaced directory, which exercises the same shell-quoting failure mode that breaks real Windows `.cmd` execution after resolution.
