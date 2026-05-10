# HTG-2026-05-11-doctor-verify-warn-fix

## Scope

Fix the two `pnpm happytg doctor` / `pnpm happytg verify` WARN conditions observed after the 0.4.14 release:

- Codex smoke succeeds but stderr contains a benign slow SQLite `sqlx::query` diagnostic.
- Public Caddy Mini App URL returns HTTP 200 without HappyTG Mini App identity.

## Non-goals

- Do not weaken real Codex smoke failure reporting.
- Do not accept generic HTTP 200 as a valid Mini App identity check.
- Do not expose or commit secrets from `.env`, Caddy config, Telegram tokens, or private endpoints.
- Do not introduce Ollama fallback or cloud-only diagnostics.

## Acceptance Criteria

1. Codex smoke diagnostics classify successful-smoke slow SQLite stderr as non-warning while preserving real failure warnings.
2. Public Mini App Caddy route returns HappyTG identity or the remaining blocker is documented as an external operator change with exact evidence.
3. `pnpm happytg doctor` and `pnpm happytg verify` no longer report those two WARNs in the local environment, or any remaining WARN is explicitly outside repo scope.
4. Focused tests and the smallest relevant repo validation pass.
5. Proof evidence is captured under this task bundle.

## Verification Plan

- Reproduce `doctor` and `verify` WARNs with raw output.
- Inspect bootstrap Codex smoke classification and Mini App identity checks.
- Add focused tests for any code classifier change.
- Repair local Caddy route if the warning is external configuration drift and validate with public probes.
- Run focused tests, `pnpm happytg doctor`, `pnpm happytg verify`, and task validation.
