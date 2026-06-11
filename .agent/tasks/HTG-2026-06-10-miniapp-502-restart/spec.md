# HTG-2026-06-10-miniapp-502-restart

## Scope

Restore the currently configured HappyTG Telegram Mini App route without changing production code unless runtime checks prove code/config drift.

## Acceptance

- `https://happytg.gerta.crazedns.ru:5083/miniapp/ready` no longer returns `502`.
- `https://happytg.gerta.crazedns.ru/miniapp` opens in Chromium and is the Telegram Mini App URL.
- Host-side HappyTG API listens on `127.0.0.1:4001`.
- Host-side HappyTG Mini App listens on `127.0.0.1:3008` and points at `http://127.0.0.1:4001`.
- Public `/miniapp` route returns HappyTG Mini App identity.

## Constraints

- Preserve the existing BaseDeploy Caddy route shape: `/miniapp` -> `127.0.0.1:3008`, allowed Mini App API paths -> `127.0.0.1:4001`.
- Keep broad public `/api/*` blocked.
- Do not expose secrets or Telegram tokens in proof.
- Do not make git commits.

## Scope Amendment

During browser verification, `:5083` stayed healthy for `curl` but timed out in Chromium. The Telegram URL scope was therefore amended to use the standard HTTPS `/miniapp` route after it passed both `curl` and Chromium smoke tests.
