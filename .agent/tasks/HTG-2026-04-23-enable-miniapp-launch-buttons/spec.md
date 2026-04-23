# Task Spec

- Task ID: HTG-2026-04-23-enable-miniapp-launch-buttons
- Title: Enable Telegram Mini App launch buttons through public HTTPS
- Owner: codex
- Mode: proof-loop
- Status: frozen

## Problem

HappyTG local development can run with localhost Mini App URLs, but Telegram WebAppInfo and MenuButtonWebApp require a public HTTPS URL. The bot must render inline Mini App launch buttons only when the resolved Mini App URL is public HTTPS, and the persistent Telegram menu button must be configured only after the exact public `/miniapp` route passes preflight.

## Acceptance Criteria

1. Current sanitized environment and diagnostics identify the resolved Mini App URL before any change and explain whether Telegram launch is ready or disabled.
2. The selected Mini App launch URL is a public HTTPS URL that points at `/miniapp`; localhost, loopback, private/internal, `.local`, `.internal`, and plain HTTP URLs are not sent to Telegram.
3. The public `/miniapp` route is verified reachable with HTTP 2xx/3xx from this environment, and Caddy/reverse-proxy routing for `/miniapp` is recorded.
4. Runtime readiness reports `miniAppLaunch.status = "ready"` and the selected public HTTPS Mini App launch URL after configuration.
5. `/start` or `/menu` inline launch button behavior is verified to include a Telegram `web_app` button with the selected public HTTPS URL.
6. `pnpm happytg telegram menu set --dry-run` passes and shows the same public HTTPS URL in the MenuButtonWebApp payload.
7. `pnpm happytg telegram menu set` succeeds, or a safe blocker is recorded without bypassing preflight.
8. Required repository checks and `pnpm happytg task validate --repo . --task HTG-2026-04-23-enable-miniapp-launch-buttons` pass in a fresh verifier pass.

## Constraints

- Runtime: keep local development URLs usable for diagnostics; do not change Telegram update delivery mode unless separately proven necessary.
- Policy implications: do not weaken public HTTPS URL validation, Telegram menu preflight, or Mini App URL resolution safety.
- Security boundaries: do not record bot tokens, API keys, cookies, Telegram initData, or private Telegram user IDs in evidence.
- Out of scope: BotFather profile-level Main Mini App setup unless explicitly requested; unrelated runtime artifacts such as `apps/host-daemon/.agent/`.

## Verification Plan

- Unit: run `pnpm --filter @happytg/bot test`, `pnpm --filter @happytg/bootstrap test`, and `pnpm test` if code or docs change.
- Integration: run `pnpm happytg doctor --json`, `pnpm happytg verify --json`, `pnpm happytg telegram menu set --dry-run`, `pnpm happytg telegram menu set`, and public `/miniapp` route probes.
- Manual: inspect sanitized `/ready`, startup metadata, inline `/start` or `/menu` button payload, and Caddy `/miniapp` routing.
- Evidence files to produce: `raw/init-env-summary.txt`, `raw/doctor-before.json`, `raw/verify-before.json`, `raw/bot-ready-before.json`, `raw/public-miniapp-route.txt`, `raw/caddy-miniapp-route.txt`, `raw/env-change.txt`, `raw/bot-ready-after.json`, `raw/telegram-menu-dry-run.txt`, `raw/telegram-menu-set.txt`, `raw/start-menu-inline-button.txt`, `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/typecheck.txt`, `raw/build.txt`, `raw/lint.txt`, `raw/task-validate.txt`, plus summary `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json`.
