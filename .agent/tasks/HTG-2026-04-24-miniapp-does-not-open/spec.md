# Task Spec

- Task ID: HTG-2026-04-24-miniapp-does-not-open
- Title: Repair Telegram Mini App launch/open failure
- Owner: codex
- Mode: proof-loop
- Status: frozen

## Problem

Telegram Mini App launch from Telegram currently does not reach a usable HappyTG Mini App screen. The failure may be Telegram URL selection, public HTTPS reachability, Caddy routing, Mini App server startup, HTML/content-type/base-path behavior, static assets, or auth/session bootstrap. The repair must identify the real root cause and ship the smallest defensible fix without changing the core HappyTG architecture.

## Acceptance Criteria

1. Reproduce and record the user-visible launch symptom before the fix: Telegram refusal, blank page, raw text/HTML, 404/5xx, JS/bootstrap failure, or a proven combination.
2. Record the exact Mini App URL that Telegram launch paths try to open, including `/start`, `/menu`, persistent menu setup, and relevant environment resolution.
3. Probe the intended public HTTPS `/miniapp` route and record status, redirects, TLS/reachability, content-type, and first meaningful body detail.
4. Prove whether the root cause is URL resolution, invalid/non-public URL, Caddy route mismatch, upstream/port mismatch, HTML content-type, base path, static assets, auth/bootstrap, TLS/public reachability, or a combination.
5. Preserve local direct development behavior and document the expected localhost path.
6. Preserve public HTTPS Mini App access through Caddy and do not expose generic public `/api/*`; only the established Mini App auth/session and approval resolve routes may remain public.
7. Add focused regression coverage for the repaired launch/routing behavior.
8. Complete builder verification and a fresh read-only verifier pass, including `pnpm happytg task validate --repo . --task HTG-2026-04-24-miniapp-does-not-open`.

## Constraints

- Do not migrate the Mini App to a new frontend framework.
- Do not weaken Mini App auth, Telegram public HTTPS URL validation, or route exposure boundaries.
- Do not expose generic `/api/*` publicly to make launch work.
- Do not record secrets, raw Telegram tokens, initData, cookies, or private user data.
- Keep architecture invariants: Telegram is not internal agent transport; mutating host operations remain serialized; policy precedes approval; higher-level policy cannot be weakened; heavy initialization remains lazy/cache-aware; hooks remain platform primitives.

## Investigation Plan

- Telegram launch: inspect `/start`, `/menu`, persistent menu button setup, `HAPPYTG_MINIAPP_URL`, `HAPPYTG_APP_URL`, `HAPPYTG_PUBLIC_URL`, and startapp handling.
- Public route: probe `https://happytg.gerta.crazedns.ru/miniapp`, root redirect behavior, TLS, status, headers, body identity, and failure mode.
- Proxy contract: inspect `infra/caddy/Caddyfile` for `/miniapp`, static delivery, public Mini App API exceptions, and generic `/api/*` denial.
- Runtime: inspect Mini App startup, bind/port/upstream behavior, direct localhost behavior, and reverse-proxy behavior.
- Browser/runtime: check generated HTML, JS bootstrap, Telegram WebApp object fallback, base-path links/assets, CSP/CORS/mixed-content where applicable.

## Verification Plan

- Required scoped checks:
  - `pnpm --filter @happytg/miniapp test`
  - `pnpm --filter @happytg/miniapp typecheck`
  - `pnpm --filter @happytg/miniapp build`
  - `pnpm --filter @happytg/miniapp lint`
  - `pnpm --filter @happytg/api test`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-24-miniapp-does-not-open`
- Expanded checks if shared URL resolution, Caddy/docs, proxy behavior, or shared runtime changes:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm happytg doctor`
  - `pnpm happytg verify`

## Evidence Files

Produce `task.json`, `evidence.md`, `evidence.json`, `problems.md`, `verdict.json`, and relevant raw artifacts including `raw/init-analysis.txt`, `raw/env-summary-sanitized.txt`, `raw/telegram-launch-url.txt`, `raw/public-miniapp-http.txt`, `raw/public-miniapp-headers.txt`, `raw/public-miniapp-body.txt`, `raw/caddy-contract-notes.txt`, `raw/log-snippet.txt`, `raw/browser-console.txt`, `raw/browser-network.txt`, `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/typecheck.txt`, `raw/build.txt`, `raw/lint.txt`, `raw/task-validate.txt`, and `raw/fresh-verifier.txt`.
