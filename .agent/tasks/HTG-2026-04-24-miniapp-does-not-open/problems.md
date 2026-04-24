# Problems

## Fixed

1. Public `/miniapp` health checking accepted any successful HTTP response.

   Impact: Telegram menu setup, doctor, and verify could report the Mini App route as healthy while the public edge served another application at the intended URL.

   Fix: public Caddy Mini App route preflight now validates HappyTG Mini App identity, not just status code.

2. Wrong-product public HTML was not surfaced clearly in launch diagnostics.

   Impact: `HTTP 200 text/html` from HealthOS looked operational in automation, even though it could never be a usable HappyTG Mini App launch.

   Fix: identity failure details include HTTP status and the first meaningful response body detail for diagnosis.

## Remaining Non-Blocking Notes

- `pnpm happytg doctor --json` and `pnpm happytg verify --json` still return overall `warn` because the local smoke state includes `CODEX_SMOKE_FAILED` and services were already running. Their Mini App/Caddy route checks are passing with HappyTG identity after the fix.
- Direct local development remains rooted at `http://127.0.0.1:3007/`; direct `/miniapp` on the Mini App server returns 404 because the public Caddy route strips the prefix before proxying.
