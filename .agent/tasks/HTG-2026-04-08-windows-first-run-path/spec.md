# Task Spec

- Task ID: HTG-2026-04-08-windows-first-run-path
- Title: Windows first-run path fixes for shared home resolution, Codex detection, and bot env onboarding
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

Windows first-run behavior regressed in three narrow places:

1. `packages/shared/src/index.ts` resolves `~/...` to the real Windows home in tests instead of respecting env overrides, so `packages/shared/src/index.test.ts` fails with `actual: C:\\Users\\tikta\\workspace` instead of the temp home override.
2. `pnpm dev` can falsely report `Codex CLI not found` on Windows-like environments even when `codex --version` is available through PATH shim resolution such as `codex.cmd`.
3. `apps/bot/src/index.ts` starts with `telegramConfigured: false` on first run without enough actionability when the token is missing, and normal dev loading must not miss a valid token that exists in the expected env path.

## Acceptance Criteria

1. `resolveHome()` correctly handles `~` and `~/...` on Windows and Unix-like platforms while honoring runtime/test env overrides in this order:
   `HOME`, then on Windows `USERPROFILE`, then `HOMEDRIVE` + `HOMEPATH`, then predictable platform fallback.
2. Regression tests cover Windows home resolution for `~` and `~/...`, including Windows-style separator behavior and env override precedence.
3. Windows Codex detection/runtime bootstrap no longer produces a false negative when `codex --version` is reachable via Windows-like PATH semantics, including `Path`, `PATHEXT`, npm/pnpm shim naming, and `codex.cmd`.
4. Regression tests cover the Windows-like Codex shim scenario in the runtime/bootstrap path.
5. Bot first-run behavior either picks up a valid `TELEGRAM_BOT_TOKEN` from the expected env loading path or logs a short actionable message that tells the user what to set and where, without exposing secrets.
6. `pnpm typecheck`, `pnpm test`, and `pnpm build` pass after the fix.

## Constraints

- Do not broaden scope beyond:
  - Windows test fix
  - Windows Codex detection/runtime bootstrap
  - first-run env/onboarding behavior only where needed for these logs
  - minimal docs/UX guidance only if behavior would otherwise stay stuck
- Do not refactor transport or architecture.
- Do not change unrelated lint TODOs or release mechanics.
- Do not print or persist secrets in logs or evidence.

## Verification Plan

- Update or add focused regression tests in:
  - `packages/shared/src/index.test.ts`
  - `packages/runtime-adapters/src/index.test.ts`
  - `apps/host-daemon/src/index.test.ts`
  - `apps/bot/src/index.test.ts` if needed
- Run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Record command outputs under:
  - `.agent/tasks/HTG-2026-04-08-windows-first-run-path/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-08-windows-first-run-path/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-08-windows-first-run-path/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-08-windows-first-run-path/raw/lint.txt`
