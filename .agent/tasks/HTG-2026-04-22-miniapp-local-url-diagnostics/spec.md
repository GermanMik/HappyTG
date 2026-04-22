# Task Spec

- Task ID: HTG-2026-04-22-miniapp-local-url-diagnostics
- Title: Local Mini App URL resolution and Telegram HTTPS diagnostics
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

After release 0.4.2, `pnpm dev` can start successfully with the Mini App on port `3007`, but bot runtime diagnostics report:

- `miniAppLaunchStatus: "disabled"`
- `miniAppLaunchUrl: "http://localhost:4000/miniapp"`
- a detail that can read like a broken Mini App launch state.

For local development, `HAPPYTG_PUBLIC_URL=http://localhost:4000` is needed for API/bot routing, but it must not mask the local Mini App URL. Telegram `web_app` and `setChatMenuButton` still require a public HTTPS Mini App URL, so local HTTP/localhost URLs must never be sent to Telegram launch surfaces.

## Acceptance Criteria

1. Current Mini App URL resolution is inspected in:
   - `apps/bot/src/handlers.ts`
   - `packages/shared/src/index.ts`
   - `packages/bootstrap/src/telegram-menu.ts`
   - `packages/bootstrap/src/index.ts`
2. Runtime inline `/start` and `/menu` never send unsafe HTTP/local URLs in Telegram `web_app` payloads.
3. With `HAPPYTG_MINIAPP_PORT=3007`, `HAPPYTG_APP_URL=http://localhost:3007`, and `HAPPYTG_PUBLIC_URL=http://localhost:4000`, diagnostics resolve the local Mini App URL to port `3007`, explain that polling still works, and clearly state that Telegram launch buttons need a public HTTPS `/miniapp` URL.
4. Public HTTPS `HAPPYTG_MINIAPP_URL=https://.../miniapp` enables inline Mini App buttons.
5. `pnpm happytg telegram menu set` and related bootstrap validation still reject localhost, HTTP, private, or otherwise unsafe URLs as hard failures.
6. Doctor/verify/dev diagnostics classify local HTTP Mini App launch URLs as acceptable local polling info/warning, while production menu setup remains strict.
7. Documentation and `.env.example` mention the local Mini App port `3007` guidance and the separate public HTTPS requirement for Telegram buttons.

## Constraints

- Do not make Telegram `web_app` buttons point at localhost or HTTP.
- Do not change Telegram delivery mode between polling and webhook unless required by the fix.
- Do not weaken `setChatMenuButton` validation or Caddy route preflight.
- Do not touch unrelated runtime artifacts, including `apps/host-daemon/.agent/`.
- Keep the implementation scoped to URL resolution, diagnostics, tests, and required docs.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bot test`
  - `pnpm --filter @happytg/bootstrap test`
- Repo:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-22-miniapp-local-url-diagnostics`
- Evidence files:
  - `raw/init-analysis.txt`
  - `raw/test-bot.txt`
  - `raw/test-bootstrap.txt`
  - `raw/typecheck.txt`
  - `raw/lint.txt`
  - `raw/test.txt`
  - `raw/task-validate.txt`
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
