# Evidence

Status: complete.

## Discipline Sources

- EchoVault context was retrieved before repository work. The default `memory.cmd` entrypoint failed with `ModuleNotFoundError: No module named 'memory'`, so the project memory was read through the configured Memory virtualenv. Relevant prior memories were fetched for Mini App launch URL, Telegram menu setup, and public `/miniapp` edge drift.
- The task scope was frozen in `spec.md` before production edits.
- Builder changes were limited to Telegram Mini App public route preflight identity checks and focused regression tests.

## User-Visible Symptom

The intended Telegram Web App URL was `https://happytg.gerta.crazedns.ru/miniapp`.

The reproduced public failure was not a raw-source or content-type failure. The public HTTPS route returned `HTTP 200` with `Content-Type: text/html; charset=utf-8`, but the body was a HealthOS application page (`<title>HealthOS - AI-assistent zdorovya</title>` / HealthOS assets), not HappyTG Mini App HTML. A Telegram-launched user would therefore open the intended URL but land on the wrong product/page before reaching a usable HappyTG screen.

Relevant artifacts:

- `raw/public-miniapp-http.txt`
- `raw/public-miniapp-headers.txt`
- `raw/public-miniapp-body.txt`
- `raw/telegram-menu-dry-run-before.txt`
- `raw/doctor-before.json`
- `raw/verify-before.json`

## Telegram Launch Path

The Telegram menu dry run resolved the Mini App URL to `https://happytg.gerta.crazedns.ru/miniapp`.

Before the fix, `pnpm happytg telegram menu set --dry-run` accepted the route because the preflight only proved a successful HTTP status:

`Caddy route: Public Caddy Mini App route responded with HTTP 200.`

That allowed a wrong upstream/body to pass launch validation.

## Public Route and Proxy Findings

Initial public probe:

- URL: `https://happytg.gerta.crazedns.ru/miniapp`
- Status: `200`
- Redirects: none for `/miniapp`
- Content-Type: `text/html; charset=utf-8`
- First meaningful body detail: HealthOS title/base/assets, not HappyTG Mini App

Local Caddy contract probe with forced host/SNI returned the expected HappyTG Mini App:

- `/miniapp`: `200` HappyTG HTML with `window.HAPPYTgApiBase = ""` and `window.HAPPYTgMiniAppBasePath = "/miniapp"`
- `/`: `302 Location: /miniapp`
- `/api/v1/miniapp/dashboard`: `404 Not found`, proving generic public `/api/*` was not opened

Direct local Mini App behavior remained:

- `http://127.0.0.1:3007/`: `200` HappyTG HTML for localhost development
- `http://127.0.0.1:3007/miniapp`: `404`, expected because Caddy strips `/miniapp` before proxying

Later public IPv4/browser probes returned the correct HappyTG Mini App HTML. This shows the deployment edge was corrected externally or converged, but the repo bug remained: the bootstrap preflight could still falsely accept any product serving `200 text/html` at `/miniapp`.

Relevant artifacts:

- `raw/local-miniapp-http.txt`
- `raw/local-miniapp-body.txt`
- `raw/local-caddy-miniapp-http.txt`
- `raw/local-caddy-miniapp-body.txt`
- `raw/local-caddy-api-boundary.txt`
- `raw/local-caddy-root-http.txt`
- `raw/public-miniapp-after-v4-http.txt`
- `raw/public-miniapp-after-v4-headers.txt`
- `raw/public-miniapp-after-v4-body.txt`
- `raw/browser-network.txt`
- `output/playwright/HTG-2026-04-24-miniapp-public.png`

## Root Cause

The proven launch failure was a combination:

1. Public edge route drift/misidentity: the intended public `/miniapp` URL served a different application page while still returning `HTTP 200 text/html`.
2. Bootstrap validation gap: Telegram menu setup, doctor, and verify treated `HTTP 200` as enough evidence that the Caddy `/miniapp` route was healthy.

The investigation did not prove an HTML content-type bug, Mini App base-path bug, missing static assets bug, generic `/api/*` requirement, or localhost Mini App runtime failure.

## Fix

`packages/bootstrap/src/telegram-menu.ts` now requires the public Mini App route to prove HappyTG identity. A successful response must either expose `x-happytg-service: miniapp` or return HTML/text containing the HappyTG Mini App title and server marker. Wrong-product HTML now fails preflight with the HTTP status and first meaningful body detail.

Focused tests were added/updated in:

- `packages/bootstrap/src/telegram-menu.test.ts`
- `packages/bootstrap/src/cli.test.ts`

The regression coverage includes wrong-product rejection, HappyTG body-marker acceptance, and `x-happytg-service: miniapp` header-only acceptance.

## Verification

Builder verification passed:

- `pnpm --filter @happytg/bootstrap test` - `raw/test-bootstrap.txt` (115/115 after header-only identity coverage)
- `pnpm --filter @happytg/miniapp test` - `raw/test-unit-miniapp.txt`, `raw/test-unit.txt`
- `pnpm --filter @happytg/miniapp typecheck` - `raw/typecheck-miniapp.txt`, `raw/typecheck.txt`
- `pnpm --filter @happytg/miniapp build` - `raw/build-miniapp.txt`, `raw/build.txt`
- `pnpm --filter @happytg/miniapp lint` - `raw/lint-miniapp.txt`, `raw/lint.txt`
- `pnpm --filter @happytg/api test` - `raw/test-api.txt`, `raw/test-integration.txt`
- `pnpm typecheck` - `raw/typecheck-full.txt`
- `pnpm lint` - `raw/lint-full.txt`
- `pnpm test` - `raw/test-full.txt`
- `pnpm build` - `raw/build-full.txt`

Live post-fix validation:

- `pnpm happytg telegram menu set --dry-run` now reports: `Public Caddy Mini App route responded with HTTP 200 and HappyTG Mini App identity.` See `raw/telegram-menu-dry-run-after.txt`.
- `pnpm happytg doctor --json` and `pnpm happytg verify --json` report the same identity-aware Caddy detail. Their overall status remains `warn` only because the repo smoke state has `CODEX_SMOKE_FAILED` and local services were already running; this is unrelated to the Mini App route fix.
- Fresh read-only verifier pass: PASS. See `raw/fresh-verifier.txt`.
- Task validation: PASS. See `raw/task-validate.txt`.
