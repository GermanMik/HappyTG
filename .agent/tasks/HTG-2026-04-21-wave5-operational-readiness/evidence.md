# Evidence Summary

## Acceptance Criteria Mapping

1. Shared logging redacts secrets and API exposes fast version and Prometheus metrics endpoints:
   - `packages/shared/src/index.ts`
   - `packages/shared/src/index.test.ts`
   - `apps/api/src/index.ts`
   - `apps/api/src/index.test.ts`

2. Mini App sessions and launch grants support explicit revoke paths with audit records:
   - `apps/api/src/service.ts`
   - `apps/api/src/service.test.ts`

3. Self-hosted compose includes Caddy plus Prometheus/Grafana observability scaffold:
   - `infra/docker-compose.example.yml`
   - `infra/prometheus/prometheus.yml`
   - `infra/grafana/provisioning/datasources/prometheus.yml`
   - `.env.example`

4. Security, observability, backup, upgrade, rollback, and release readiness docs are updated:
   - `SECURITY.md`
   - `docs/security/hardening.md`
   - `docs/operations/observability.md`
   - `docs/operations/runbook.md`
   - `docs/self-hosting.md`

5. CI and verification gates cover lint, typecheck, test, build, and task validation:
   - `.github/workflows/ci.yml`
   - `.github/workflows/release.yml`
   - `raw/test-unit.txt`
   - `raw/lint.txt`
   - `raw/test-integration.txt`
   - `raw/build.txt`

## Verification

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm test` passed.
- `pnpm build` passed.
