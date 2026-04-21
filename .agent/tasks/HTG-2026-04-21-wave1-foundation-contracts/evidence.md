# Evidence Summary

## Acceptance Criteria Mapping

1. Protocol state and event contracts match the Wave 1 canonical model without adding a parallel architecture.
   - `packages/protocol/src/index.ts` now exports canonical session, task, approval, verification, tool category, approval scope, and event contracts.
   - `EVENT_CONTRACTS` records payload shape, producer, consumers, and idempotency notes for core events.
   - Existing API, worker, bot tests were updated to use `preparing`, `ready`, `needs_approval`, `resuming`, and canonical approval outcomes.

2. Repo-proof bundle supports `state.json` while preserving existing `.agent/tasks` compatibility.
   - `packages/repo-proof/src/index.ts` now writes `state.json` and keeps `task.json`.
   - Validation exposes legacy `ok/missing` and canonical `canonicalOk/canonicalMissing`.
   - Mini App/API artifact listings include `state.json`.

3. Public topology and infra skeleton are documented for `happytg.gerta.crazedns.ru`.
   - `infra/caddy/Caddyfile` defines path routing for `/miniapp`, `/api/*`, `/health`, `/bot/webhook`, and `/static/*`.
   - `docs/architecture/foundation-contracts.md`, `docs/self-hosting.md`, and `infra/README.md` document the topology.
   - `infra/db/migrations/.gitkeep` reserves the migration directory without inventing a second persistence stack.

## Verification Commands

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm happytg task validate --repo . --task HTG-2026-04-21-wave1-foundation-contracts --json`

## Artifacts

- `raw/typecheck.txt`
- `raw/lint.txt`
- `raw/test-unit.txt`
- `raw/build.txt`
- `raw/test-integration.txt`
