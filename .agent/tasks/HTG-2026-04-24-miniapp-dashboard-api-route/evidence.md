# Evidence

Status: complete.

## Baseline

Public/local Caddy before the fix blocked dashboard at the routing layer:

- `https://happytg.gerta.crazedns.ru/api/v1/miniapp/dashboard` through local Caddy host/SNI returned `404 Not found`.
- Direct API `http://127.0.0.1:4000/api/v1/miniapp/dashboard` returned `401 {"error":"Mini App session auth required"}`.

This proves the API route existed and was auth-protected; Caddy allowlist was the blocker.

Artifacts:

- `raw/before-local-caddy-dashboard.txt`
- `raw/direct-api-dashboard-no-auth.txt`
- `raw/before-local-caddy-generic-api.txt`

## Fix

Added a narrow dashboard exception before generic `/api/*` deny:

- `infra/caddy/Caddyfile`: `handle /api/v1/miniapp/dashboard { reverse_proxy api:4000 }`
- `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile`: same route for the live local deployment and the `https://:8443` HappyTG fallback block

No broad `/api/v1/miniapp*` or generic `/api/*` exposure was introduced.

Focused regression coverage:

- `packages/bootstrap/src/infra-config.test.ts` now verifies auth/session, dashboard, and approval resolve exceptions all appear before `handle /api/*`, verifies the generic deny rule remains, and rejects a broad `/api/v1/miniapp*` handle.

## Post-Fix Probes

After Caddy reload:

- Local Caddy dashboard route: `401 Unauthorized`, JSON `Mini App session auth required`.
- Public IPv4 dashboard route: `401 Unauthorized`, JSON `Mini App session auth required`.
- Local Caddy generic `/api/v1/tasks`: `404 Not found`.
- Public IPv4 generic `/api/v1/tasks`: `404`.

Artifacts:

- `raw/caddy-reload.txt`
- `raw/after-local-caddy-dashboard.txt`
- `raw/after-local-caddy-generic-api.txt`
- `raw/after-public-dashboard-v4.txt`
- `raw/after-public-generic-api-v4.txt`

## Verification

- `pnpm --filter @happytg/bootstrap test` passed 116/116: `raw/test-bootstrap.txt`, `raw/test-unit.txt`
- `pnpm --filter @happytg/api test` passed 16/16: `raw/test-api.txt`, `raw/test-integration.txt`
- `pnpm --filter @happytg/bootstrap lint` passed: `raw/lint-bootstrap.txt`, `raw/lint.txt`
- `pnpm --filter @happytg/bootstrap build` passed: `raw/build-bootstrap.txt`, `raw/build.txt`
- `pnpm happytg task validate --repo . --task HTG-2026-04-24-miniapp-dashboard-api-route` passed: `raw/task-validate.txt`
