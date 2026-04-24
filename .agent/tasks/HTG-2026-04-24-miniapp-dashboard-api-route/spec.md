# Task Spec

- Task ID: HTG-2026-04-24-miniapp-dashboard-api-route
- Title: Expose authenticated Mini App dashboard API through public Caddy route
- Owner: codex
- Mode: proof
- Status: frozen

## Problem

The API implements `GET /api/v1/miniapp/dashboard` and protects it with Mini App session auth, but the public Caddy contract currently returns `404` before the request reaches the API. This can break same-origin Mini App dashboard API access while preserving auth at the API layer.

## Acceptance Criteria

1. Reproduce that public Caddy blocks `/api/v1/miniapp/dashboard` as `404` while direct API has the endpoint and requires auth.
2. Add the smallest Caddy/public-surface fix for dashboard only.
3. Preserve the generic `/api/*` public deny rule.
4. Preserve existing Mini App auth/session and approval resolve routes.
5. Add focused regression coverage for the Caddy contract.
6. Verify with targeted tests and task validation.

## Constraints

- Do not expose generic `/api/*` publicly.
- Do not weaken Mini App API auth.
- Do not change core HappyTG architecture.
- Keep the route list explicit and narrow.

## Verification Plan

- Probe local public Caddy dashboard route before and after.
- Probe direct API dashboard unauthenticated response.
- Run `pnpm --filter @happytg/bootstrap test`.
- Run `pnpm --filter @happytg/api test`.
- Run `pnpm happytg task validate --repo . --task HTG-2026-04-24-miniapp-dashboard-api-route`.
