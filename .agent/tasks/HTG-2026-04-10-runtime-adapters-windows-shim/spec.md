# Task Spec

- Task ID: HTG-2026-04-10-runtime-adapters-windows-shim
- Title: Fix Windows codex.cmd readiness execution regression in runtime-adapters
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

Windows readiness checks in `@happytg/runtime-adapters` regress when `checkCodexReadiness()` finds a `codex.cmd` shim through mixed-case `Path` / `path` and `PATHEXT` / `pathext`, but the subsequent execution path still reports the runtime as unavailable. The likely failure is in the Windows spawn path for `.cmd` shims rather than in executable discovery alone.

## Acceptance Criteria

1. `checkCodexReadiness()` reports `available === true` for the Windows `.cmd` shim cases covered by `Path`, lowercase `path` / `pathext`, and duplicate-cased `PATH` / `Path` plus `PATHEXT` / `pathext`.
2. The fix is minimal and does not regress true missing-command behavior (`ENOENT` / command-not-found remains `missing === true`).
3. Benign smoke warning filtering remains unchanged.
4. If shared Windows env/executable helpers change, `@happytg/shared` tests continue to pass.

## Constraints

- Keep scope limited to `@happytg/runtime-adapters` and only touch shared helpers if the root cause requires it.
- Do not weaken missing-command detection or change readiness/smoke semantics outside the Windows `.cmd` execution path.
- Preserve existing behavior for non-Windows command execution.

## Verification Plan

- Reproduce the failure with:
  - `pnpm --filter @happytg/runtime-adapters test`
- Run targeted post-fix verification:
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/shared test` if shared code changes
  - `pnpm typecheck` if scope allows
  - `pnpm lint` if scope allows
- Record outputs in:
  - `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-10-runtime-adapters-windows-shim/raw/lint.txt`
