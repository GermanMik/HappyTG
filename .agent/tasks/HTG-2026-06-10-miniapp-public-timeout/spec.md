# HTG-2026-06-10-miniapp-public-timeout

## Scope

Fix the Telegram bot Mini App launch path after the user reported that `happytg.gerta.crazedns.ru` timed out in the browser/WebView.

## Acceptance criteria

- The public Mini App URL used by the bot opens in Chromium/WebView.
- The bot `/ready` endpoint reports an enabled `miniAppLaunch` with the working URL.
- The public Caddy route returns HappyTG Mini App identity.
- Telegram persistent menu is updated to the working Mini App URL.
- HappyTG `doctor` and `verify` complete with no routing failure.

## Out of scope

- Reworking KeenDNS/router TLS behavior on the default `443` route.
- Changing Telegram into an internal event transport.
- Unrelated code refactors.

