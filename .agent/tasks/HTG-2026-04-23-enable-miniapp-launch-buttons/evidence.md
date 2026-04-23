# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Current resolved Mini App URL before change | `raw/init-env-summary.txt`, `raw/doctor-before.json`, and `raw/bot-ready-before.json` show `HAPPYTG_MINIAPP_URL` was unset and the resolver fell back to local `http://localhost:3001/`; Telegram launch was disabled/unsafe because WebAppInfo/MenuButtonWebApp require public HTTPS. |
| Public HTTPS `/miniapp` URL selected | `raw/env-change.txt` records `HAPPYTG_MINIAPP_URL=https://happytg.gerta.crazedns.ru/miniapp`; local `HAPPYTG_APP_URL=http://localhost:3007` remains diagnostics-only and was not used for Telegram launch payloads. |
| Public route reachable | Pass. Earlier probes captured the public edge/TLS blocker; after the external route was fixed, `raw/public-miniapp-route-recheck-2.txt` shows `https://happytg.gerta.crazedns.ru/miniapp` returned HTTP 200. `:8443` remains unavailable and was not selected. |
| Caddy/reverse proxy route recorded | `raw/caddy-miniapp-route.txt` records the repo Caddy route. `raw/caddy-active-config-after.json` and `raw/basedeploy-caddy-reload.txt` record the host Caddy route added in BaseDeploy. Host-run Caddy needs `HAPPYTG_MINIAPP_UPSTREAM=127.0.0.1:3007`; Docker Compose Caddy should keep default upstream `miniapp:3001`. |
| Runtime readiness reports launch ready | `raw/bot-ready-final.json` reports `miniAppLaunch.status = "ready"` and `miniAppLaunch.url = "https://happytg.gerta.crazedns.ru/miniapp"`. Telegram update mode remained `auto`, with active polling selected because `HAPPYTG_PUBLIC_URL` is still local HTTP. |
| Inline `/start` or `/menu` button verified | `raw/start-menu-inline-button.txt` shows `/start` and `/menu` include Telegram `web_app` buttons using `https://happytg.gerta.crazedns.ru/miniapp?screen=home`; no localhost URL is present. `raw/session-detail-inline-button.txt` verifies session/detail/diff Mini App buttons use the same public base URL. |
| Telegram menu dry-run passes | Pass. `raw/telegram-menu-dry-run-final-2.txt` reports `HappyTG telegram menu set [PASS]`, public Caddy HTTP 200, and the MenuButtonWebApp payload with `https://happytg.gerta.crazedns.ru/miniapp`. |
| Telegram menu set succeeds or safe blocker recorded | Pass. `raw/telegram-menu-set-final-2.txt` reports Telegram accepted `setChatMenuButton` for the public HTTPS Mini App URL. |
| Fresh verifier and task validation pass | `raw/task-validate.txt` reports `Validation: ok`; `raw/fresh-verifier.txt` passes the proof checks and returns verdict `complete`. |

## Build Notes

- `pnpm --filter @happytg/bot test`: pass (`raw/test-unit.txt`).
- `pnpm --filter @happytg/bootstrap test`: pass (`raw/test-bootstrap.txt`, appended to `raw/test-unit.txt`).
- `pnpm typecheck`: pass (`raw/typecheck.txt`).
- `pnpm lint`: pass (`raw/lint.txt`).
- `pnpm test`: pass (`raw/test-integration.txt`).
- `pnpm build`: pass (`raw/build.txt`).
- `pnpm happytg doctor --json`: exit 0; task-relevant checks pass with Mini App URL public HTTPS and Caddy HTTP 200 (`raw/doctor-final-2.json`).
- `pnpm happytg verify --json`: exit 0; task-relevant checks pass with Mini App URL public HTTPS and Caddy HTTP 200 (`raw/verify-final-2.json`).
- `pnpm happytg task validate --repo . --task HTG-2026-04-23-enable-miniapp-launch-buttons`: pass (`raw/task-validate.txt`).
- Fresh verifier pass: pass with complete verdict (`raw/fresh-verifier.txt`).
- Code fix: `packages/bootstrap/src/telegram-menu.ts` now uses a Windows PowerShell Telegram Bot API fallback only when the real post-preflight Node fetch fails before Telegram responds. This allowed `pnpm happytg telegram menu set` to succeed in the current Windows environment where PowerShell can reach Telegram but Node/curl time out.

## Residual Risk

- `pnpm happytg doctor --json` and `pnpm happytg verify --json` still report overall `warn` because of unrelated Codex websocket/plugin smoke warnings and already-running local services. The Mini App URL, Caddy route, inline buttons, dry-run, and Telegram menu set checks are green.
