# Task Spec

- Task ID: HTG-2026-04-22-telegram-menu-button-caddy
- Title: Telegram persistent Mini App menu button and Caddy route preflight
- Owner: HappyTG
- Mode: proof-loop
- Status: frozen

## Problem

HappyTG currently exposes the Mini App through inline Telegram `web_app` buttons in `/start` and `/menu`, but it has no first-class command to configure Telegram's persistent bot menu button with `setChatMenuButton`. The setup must be explicit, safe for production, and gated by public HTTPS availability of the Mini App through the Caddy route for `happytg.gerta.crazedns.ru`.

## Acceptance Criteria

1. `pnpm happytg telegram menu set`, `pnpm happytg telegram menu set --dry-run`, and `pnpm happytg telegram menu reset` exist.
2. Menu setup reads env through existing repo helpers, resolves Mini App URL with priority `HAPPYTG_MINIAPP_URL` > `HAPPYTG_APP_URL` > `HAPPYTG_PUBLIC_URL + /miniapp`, and prints the exact URL sent to Telegram.
3. Menu setup rejects missing token, invalid URL, HTTP, localhost, loopback, private/internal hosts, and unsafe hostnames before calling Telegram.
4. Menu setup supports explicit public HTTPS ports such as `:8443` and does not assume external `443`.
5. Menu setup checks public Caddy availability for `/miniapp` before calling Telegram and blocks setup when unavailable.
6. Telegram `setChatMenuButton` payload matches `MenuButtonWebApp` with text `HappyTG` and the resolved URL; dry-run never calls Telegram.
7. Existing inline `web_app` buttons in `/start` and `/menu` remain functional.
8. `pnpm happytg doctor` or `pnpm happytg verify` reports actionable diagnostics for token, Mini App URL, public URL safety, Caddy route, and menu-button state where available.
9. `infra/caddy/Caddyfile`, docs, and env examples describe `happytg.gerta.crazedns.ru`, `/miniapp`, `/api/*`, `/bot/webhook`, root redirect, and both public `443` and explicit `:8443` deployment shapes.

## Constraints

- Runtime: Codex CLI in `C:\Develop\Projects\HappyTG`.
- Branch: work in a separate `codex/` branch.
- Proof loop: freeze this spec before implementation and record evidence under this task bundle.
- Security: never log Telegram tokens or secrets.
- Telegram URL policy: require public HTTPS URL for `WebAppInfo`; refuse localhost, loopback, private/internal, and plain HTTP.
- Architecture: do not weaken Mini App auth, launch grant, Telegram update delivery, policy evaluation, or mutating host operation queue behavior.
- Scope: keep changes minimal and reuse existing CLI/env/transport patterns where reasonable.
- Out of scope: automatic BotFather profile/Main Mini App configuration and production TLS certificate issuance automation.

## Verification Plan

- Unit: URL priority, unsafe URL rejection, `:8443` support, payload generation, dry-run behavior, missing-token error, Caddy preflight blocking, inline `/start` and `/menu` buttons.
- Package checks: `pnpm --filter @happytg/bot test` and `pnpm --filter @happytg/bootstrap test`.
- Repo checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Task validation: `pnpm happytg task validate --repo . --task HTG-2026-04-22-telegram-menu-button-caddy`.
- Evidence files: `.agent/tasks/HTG-2026-04-22-telegram-menu-button-caddy/raw/*.txt`, `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json`.
