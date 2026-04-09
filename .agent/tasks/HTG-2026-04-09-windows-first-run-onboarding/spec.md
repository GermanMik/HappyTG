# Task Spec

- Task ID: HTG-2026-04-09-windows-first-run-onboarding
- Title: Windows first-run fixes for home resolution, Codex bootstrap detection, and GitHub-facing onboarding
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

Windows first-run is still brittle in the exact areas surfaced by the logs:

1. `resolveHome("~/workspace")` can miss Windows home overrides in env-shaped scenarios and the regression coverage is not strong enough around Windows-specific env lookup semantics.
2. Codex bootstrap/runtime detection needs to stay accurate in Windows PATH shim cases such as `codex.cmd`, mixed `Path`/`PATH`, and `PATHEXT` lookup without producing a false `Codex CLI not found`.
3. Bot first-run behavior must either consume a valid Telegram token from the expected `.env` path or emit a short actionable message instead of leaving the operator with an unclear `telegramConfigured: false`.
4. GitHub-facing first-run docs still read too much like internal file/path dumps and need cleaner navigation plus small GitHub-compatible visuals for onboarding.

## Acceptance Criteria

1. Windows home resolution honors env overrides for `~` and `~/...` with predictable precedence across `HOME`, `USERPROFILE`, and `HOMEDRIVE` + `HOMEPATH`, without regressing Unix/macOS behavior.
2. Regression tests cover Windows-style env lookup and home expansion, including case-insensitive env-key handling where relevant.
3. Windows Codex detection no longer false-negatives when `codex --version` is reachable through PATH shim semantics, including `codex.cmd`, `Path`/`PATH`, and `PATHEXT`.
4. Regression tests cover Windows Codex detection/shim scenarios at the shared/runtime/bootstrap path.
5. Bot first-run behavior either loads a valid `TELEGRAM_BOT_TOKEN` from the expected env path or emits a short actionable warning without leaking secrets.
6. `README.md` plus bootstrap/onboarding docs become clearer on GitHub through cleaner document-title links, minimal first-run visuals, and compact first-run tables without turning the docs into marketing copy.
7. `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Constraints

- Limit changes to:
  - Windows test fix
  - Windows Codex detection/runtime bootstrap
  - first-run env/onboarding behavior only where needed for these logs
  - minimal docs/UX hints needed to avoid first-run dead ends
  - GitHub-facing README/installation/quickstart/bootstrap navigation improvements within onboarding scope
- Do not refactor transport, policy, or runtime architecture.
- Do not change unrelated release mechanics or lint TODOs.
- Do not print or persist secrets in logs or evidence.

## Verification Plan

- Add or update focused tests in:
  - `packages/shared/src/index.test.ts`
  - `packages/runtime-adapters/src/index.test.ts`
  - `apps/bot/src/index.test.ts`
  - `packages/bootstrap/src/index.test.ts` and/or `apps/host-daemon/src/index.test.ts` if the regression path is exercised there
- Run and capture:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Record outputs under:
  - `.agent/tasks/HTG-2026-04-09-windows-first-run-onboarding/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-first-run-onboarding/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-first-run-onboarding/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-first-run-onboarding/raw/lint.txt`
  - `.agent/tasks/HTG-2026-04-09-windows-first-run-onboarding/raw/typecheck.txt`
