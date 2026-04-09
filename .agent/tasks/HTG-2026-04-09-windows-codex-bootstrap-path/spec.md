# Task Spec

- Task ID: HTG-2026-04-09-windows-codex-bootstrap-path
- Title: Fix Windows Codex readiness/bootstrap false negatives
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

Windows first-run detection for Codex is producing a false negative in the runtime/bootstrap path:

1. `@happytg/runtime-adapters` fails the Windows Codex readiness tests.
2. `pnpm dev`, `pnpm happytg doctor`, and `pnpm happytg verify` can incorrectly report `Codex CLI not found` / `Codex: not found` even when `codex --version` works in the same Windows PowerShell session.
3. The current Windows `.cmd` test harness is not representative of a real Windows shim and may itself be the reason the Windows tests fail.

## Acceptance Criteria

1. `checkCodexReadiness()` correctly resolves and executes Windows Codex shims through mixed-case `PATH` / `Path` and `PATHEXT` / `pathext` handling without false negatives.
2. Windows readiness/bootstrap logic preserves the actionable missing message only for truly missing Codex binaries.
3. `packages/runtime-adapters/src/index.test.ts` uses a realistic Windows `.cmd` harness on Windows and remains a valid regression suite for the Windows scenario.
4. Bootstrap/doctor coverage proves that a found Windows Codex shim does not surface `CODEX_MISSING`.
5. `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Constraints

- Keep scope limited to Windows Codex detection/bootstrap/runtime path and its tests.
- Do not change Telegram placeholder handling, port-conflict handling, transport/policy logic, or unrelated docs.
- Keep fixes minimal and directly tied to the logged false negative.

## Verification Plan

- Add or update focused regressions in:
  - `packages/shared/src/index.test.ts`
  - `packages/runtime-adapters/src/index.test.ts`
  - `packages/bootstrap/src/index.test.ts`
- Run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Record outputs in:
  - `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/typecheck.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-codex-bootstrap-path/raw/lint.txt`
