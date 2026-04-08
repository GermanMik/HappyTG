# Task Spec

- Task ID: HTG-2026-04-08-doctor-green-first-start
- Title: Make doctor green for benign Codex warnings and document first start
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

`pnpm happytg doctor` currently reports `WARN` on this machine even when Codex smoke execution succeeds, because Codex CLI writes noisy internal state-db and shell-snapshot warnings to stderr. That makes doctor look unhealthy even though the actual smoke prompt returns `OK`. The raw stderr is still useful for JSON diagnostics, but the normal doctor/status/verify path should not stay yellow for known benign Codex-internal noise alone.

At the same time, the repository quickstart/install docs still describe first start too abstractly. They need a concrete command sequence for install, doctor, control-plane startup, pairing, and daemon startup so the launch description matches the actual repo entrypoints.

## Acceptance Criteria

1. Bootstrap doctor/status/verify stay green when Codex smoke succeeds and stderr contains only known benign Codex internal state warnings; raw stderr remains available in --json diagnostics.
2. Real Codex smoke failures and unknown stderr still surface as actionable findings.
3. Repository launch/quickstart docs include concrete first-start commands, including install, doctor, control-plane start, pairing, and daemon start.
4. Tests cover benign-warning filtering and preserve existing diagnostics separation behavior.

## Constraints

- Runtime: Codex CLI remains the primary runtime; raw smoke stderr must stay available in JSON diagnostics.
- Unknown stderr and real smoke failures must still surface as findings; do not broadly suppress all stderr.
- Keep machine-readable JSON/report structure compatible unless a small additive change is strictly required.
- Update only docs that are part of the user-facing first-start path; do not redesign broader product onboarding.
- Out of scope:
- changing Telegram pairing product behavior
- broad bootstrap subsystem redesign
- hiding real Codex failures behind overly permissive filtering

## Verification Plan

- Unit:
- `pnpm --filter @happytg/bootstrap test`
- targeted tests for any runtime/bootstrap helper changes
- Integration:
- `pnpm happytg doctor`
- `pnpm happytg doctor --json`
- `pnpm happytg verify`
- `pnpm test`
- `pnpm typecheck`
- Manual:
- confirm doctor becomes `PASS`/green when smoke succeeds and stderr contains only known benign Codex-internal warnings
- confirm `doctor --json` still exposes raw `smokeError`
- review README/quickstart/install docs for a concrete first-start command sequence
