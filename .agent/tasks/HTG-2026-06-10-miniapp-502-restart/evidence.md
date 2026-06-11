# Evidence

Status: complete with one unrelated warning.

## Initial Findings

- EchoVault and prior task evidence show the current live route should use `https://happytg.gerta.crazedns.ru:5083/miniapp`.
- BaseDeploy Caddy routes HappyTG `/miniapp` to `127.0.0.1:3008` and allowed Mini App API routes to `127.0.0.1:4001`.
- Current host state had no listeners on `3008` or `4001`, so the public `502` is consistent with a down upstream.

## Actions

- Started host-side HappyTG API on `127.0.0.1:4001` with `HAPPYTG_CODEX_DESKTOP_CONTROL=app-server`.
- Started host-side HappyTG Mini App on `127.0.0.1:3008` with `HAPPYTG_API_URL=http://127.0.0.1:4001`.
- Updated local `.env` `HAPPYTG_MINIAPP_URL` from `https://happytg.gerta.crazedns.ru:5083/miniapp` to `https://happytg.gerta.crazedns.ru/miniapp`.
- Ran `pnpm happytg telegram menu set`; Telegram accepted the no-port Mini App menu button.

## Results

- Local API `/ready` returned `{ "ok": true, "service": "api" }`.
- Local Mini App `/ready` returned `{ "ok": true, "service": "miniapp", "apiBaseUrl": "http://127.0.0.1:4001" }`.
- Public `https://happytg.gerta.crazedns.ru:5083/miniapp/ready` returned HTTP 200 after the host-side restart.
- Chromium/Playwright timed out on `https://happytg.gerta.crazedns.ru:5083/miniapp` with `ERR_TIMED_OUT`, so `:5083` is not browser-safe from this host/browser path.
- Public `https://happytg.gerta.crazedns.ru/miniapp` returned HTTP 200 and opened in Chromium as `HappyTG Mini App` with no console errors or warnings.
- `pnpm happytg telegram menu set --dry-run` now selects `https://happytg.gerta.crazedns.ru/miniapp`.
- `HAPPYTG_API_PORT=4001 HAPPYTG_MINIAPP_PORT=3008 pnpm happytg verify` exited 0. It reported one unrelated Codex CLI memory-retention warning and reused Mini App `3008` plus API `4001`.

## Raw Outputs

- `raw/host-api-4001-restart.stdout.txt`
- `raw/host-api-4001-restart.stderr.txt`
- `raw/host-miniapp-3008-restart.stdout.txt`
- `raw/host-miniapp-3008-restart.stderr.txt`
- `raw/curl-local-api-4001-ready.body.json`
- `raw/curl-local-miniapp-3008-ready.body.json`
- `raw/curl-public-5083-ready.headers.txt`
- `raw/curl-public-5083-miniapp.html`
- `raw/browser-snapshot-5083.yml`
- `raw/browser-requests-5083.txt`
- `raw/curl-public-443-ready.headers.txt`
- `raw/curl-public-443-miniapp.html`
- `raw/browser-snapshot-443.yml`
- `raw/browser-console-443.log`
- `raw/telegram-menu-set-443.txt`
- `raw/telegram-menu-dry-run-443.txt`
- `raw/happytg-verify-443-4001-3008.txt`
