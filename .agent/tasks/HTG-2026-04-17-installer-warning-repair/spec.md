# HTG-2026-04-17-installer-warning-repair

## Status

- Phase: complete
- Frozen at: 2026-04-17
- Completed at: 2026-04-17T17:46:50.1569154+03:00
- Coordinator: Codex main agent
- Builder role: coordinator main agent
- Verifier role: `task-verifier`
- Fixer role (only if verifier finds a remaining scoped issue): `task-fixer`

## Goal

Reproduce the current HappyTG installer/bootstrap diagnostics on the current branch, classify each reproduced signal truthfully, and fix only the remaining scoped issue that still blocks a green verifier pass.

## Baseline Reproduction

Fresh runs completed before any production edits:

- `pnpm happytg setup --json`
- `pnpm happytg doctor --json`
- `pnpm happytg verify --json`
- `pnpm happytg repair --json`
- `pnpm happytg install --json --non-interactive --repo-mode current --repo-dir . --background skip --post-check setup`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## Frozen Findings

### 1. Live diagnostics are currently coherent

- `setup`, `doctor`, `verify`, and `repair` all reproduced the same warning set:
  - Codex smoke completed with warnings because the Codex Responses websocket returned `403 Forbidden` and the CLI fell back to HTTP.
  - HappyTG API on port `4000` is already running and should be reused.
  - Mini App port `3001` is occupied by Docker listener `contacts-frontend`, with actionable reuse/remap guidance to `3006`.
- Supported infra reuse for Redis/Postgres/MinIO is classified as reuse rather than generic conflict.
- The stale pairing code from the historical log is not part of the current acceptance target.

### 2. `install` failure is a truthful environment constraint, not a reproduced product bug

- Current `install` fails recoverably because Telegram `getMe` reaches Telegram through the Windows fallback transport and returns `401 Unauthorized`.
- The same output also records that direct Node HTTPS timed out earlier, but the fallback reaching Telegram means the current decisive classification is `invalid_token`.
- Pairing is therefore correctly blocked until the operator fixes the bot token.

### 3. Current blocking red is in tests, not in reproduced runtime diagnostics

- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` fails only in two bootstrap regression tests in `packages/bootstrap/src/install.runtime.test.ts`.
- The reproduced failure shape indicates machine-state leakage from the real local HappyTG daemon state (`~/.happytg/daemon-state.json`) into tests that expected a fresh host with no saved daemon state.

## In Scope

- Fix the reproduced bootstrap test isolation issue with the minimum scoped change.
- Keep runtime/product behavior unchanged unless new evidence proves a real product bug still exists.
- Re-run targeted bootstrap tests plus full repo verification.
- Record signal classification and verification evidence in this proof bundle.

## Out of Scope

- Publish, release, branch/PR, tag, or merge flow.
- Refactors outside the minimum scope needed for a green proof loop.
- Silencing truthful environment warnings.
- Changing current Telegram/Codex/port diagnostics without fresh contradictory evidence from the local repo and command runs.

## Acceptance Criteria

1. `setup`, `doctor`, `verify`, `repair`, and `install` remain mutually coherent on the current machine.
2. Legitimate environment constraints remain visible and are not downgraded into false greens.
3. The reproduced `pnpm test` red is resolved with a minimal scoped fix.
4. No unnecessary production-code changes are made if the remaining issue is only test isolation.
5. The proof bundle contains the baseline evidence, classification, fix evidence, and a fresh verifier pass.

## Evidence Plan

- Use the already captured raw baseline outputs under `raw/`.
- Add targeted bootstrap test reruns around the fix.
- Re-run full `pnpm test`, `pnpm lint`, and `pnpm typecheck`.
- Run an independent verifier pass after the build phase without production edits.
