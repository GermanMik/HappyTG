# Evidence

Status: passed with operational warnings unrelated to the new Telegram menu code.

## Implementation Evidence

- Added `pnpm happytg telegram menu set`, `pnpm happytg telegram menu set --dry-run`, and `pnpm happytg telegram menu reset`.
- Menu setup loads `.env` through `loadHappyTGEnv`, reads `TELEGRAM_BOT_TOKEN`, resolves Mini App URL by `HAPPYTG_MINIAPP_URL` > `HAPPYTG_APP_URL` > `HAPPYTG_PUBLIC_URL + /miniapp`, validates public HTTPS, blocks localhost/private/internal/HTTP URLs, checks public Caddy `/miniapp`, and only then calls Telegram `setChatMenuButton`.
- Dry-run prints the exact Mini App URL and payload and does not call Telegram.
- Reset uses `setChatMenuButton` with `{ "menu_button": { "type": "default" } }`.
- `doctor`/`verify` now report Telegram Mini App URL safety, Caddy `/miniapp` preflight, and menu-button check availability without logging secrets.
- Existing inline `/start` and `/menu` Mini App buttons remain covered by bot tests.
- Docs and `.env.example` now distinguish inline buttons, persistent menu button, and BotFather/Main Mini App, and document public `443` versus explicit `:8443`.

## Public Caddy Evidence

- `raw/caddy-public-miniapp-443.txt`: `pnpm happytg telegram menu set --dry-run` with `https://happytg.gerta.crazedns.ru/miniapp` passed and reported `Public Caddy Mini App route responded with HTTP 200.`
- `raw/caddy-public-miniapp.txt`: same dry-run with `https://happytg.gerta.crazedns.ru:8443/miniapp` refused setup because `fetch failed`. This confirms the code supports the explicit port but does not claim that the current external `:8443` route is production-ready.

## Verification

- `raw/test-unit.txt`: `pnpm --filter @happytg/bot test` passed 32/32; `pnpm --filter @happytg/bootstrap test` passed 101/101.
- `raw/typecheck.txt`: `pnpm typecheck` passed 15/15 packages.
- `raw/lint.txt`: `pnpm lint` passed 15/15 packages.
- `raw/test-integration.txt`: `pnpm test` passed 15/15 packages.
- `raw/build.txt`: `pnpm build` passed 15/15 packages.
- `raw/doctor-json.txt`: `pnpm happytg doctor --json` reported Caddy `/miniapp` HTTP 200 and Telegram menu-button check unavailable by design; status was `warn` because of existing Codex websocket 403 fallback and already-running local services.
- `raw/verify-json.txt`: `pnpm happytg verify --json` reported the same Telegram/Caddy diagnostics; status was `warn` for the same unrelated operational warnings.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-04-22-telegram-menu-button-caddy` passed.
