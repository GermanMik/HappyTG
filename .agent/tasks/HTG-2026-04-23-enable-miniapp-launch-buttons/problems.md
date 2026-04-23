# Problems

## Resolved

- The public route blocker was resolved externally: `raw/public-miniapp-route-recheck-2.txt` shows `https://happytg.gerta.crazedns.ru/miniapp` returned HTTP 200.
- `pnpm happytg telegram menu set --dry-run` passed with the public HTTPS payload.
- `pnpm happytg telegram menu set` passed and Telegram accepted the HappyTG MenuButtonWebApp.
- Node/curl could not reach `api.telegram.org` from this Windows environment, while PowerShell could. `packages/bootstrap/src/telegram-menu.ts` now mirrors the existing Windows transport fallback pattern for post-preflight Telegram Bot API calls.
- The selected Mini App URL is public HTTPS and points at `/miniapp`.
- Runtime `/ready` reports `miniAppLaunch.status = "ready"` after setting `HAPPYTG_MINIAPP_URL`.
- Inline `/start`, `/menu`, session, detail, and diff surfaces render `web_app` buttons with the selected public HTTPS base URL.
- Local polling remains active; `TELEGRAM_UPDATES_MODE` was not changed.
- URL validation and Telegram menu preflight were not weakened.

## Residual Non-Blocking Warnings

- `pnpm happytg doctor --json` and `pnpm happytg verify --json` still have overall `warn` due unrelated Codex websocket/plugin smoke warnings and already-running local services. The task-relevant Telegram Mini App checks pass.
- `https://happytg.gerta.crazedns.ru:8443/miniapp` remains unreachable, but it is not the selected Mini App URL.
