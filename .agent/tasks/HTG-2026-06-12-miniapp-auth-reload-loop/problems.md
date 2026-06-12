# Problems

Task: `HTG-2026-06-12-miniapp-auth-reload-loop`

## Resolved

- Stale localStorage Mini App session could trigger repeated `location.reload()` on auth bridge pages after API `401`.
- The server did not explicitly expire the stale Mini App session cookie during `401` auth recovery.

## Residual Risks

- A user outside Telegram still cannot mint a new Mini App session because Telegram `initData` is unavailable; the page now stays on retry guidance instead of looping.
- If a reverse proxy drops `x-forwarded-prefix`, cookie path cleanup may fall back to `/`; current Caddy path is expected to preserve the `/miniapp` prefix.
