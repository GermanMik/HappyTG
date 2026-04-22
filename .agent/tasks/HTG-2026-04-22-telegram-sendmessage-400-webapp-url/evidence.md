# Evidence

## Status

- Phase: complete.
- Builder verification passed.
- Fresh verifier pass passed.
- Task validation passed in `raw/task-validate.txt`.

## Initial Findings

- EchoVault context was retrieved before work.
- Work is on branch `codex/telegram-sendmessage-400-webapp-url`.
- Existing workspace state before this task included modified `pnpm-lock.yaml` and untracked `.agent/prompts/telegram-sendmessage-400-webapp-url-repair.md`; these are treated as pre-existing user state.
- `apps/bot/src/handlers.ts` currently builds `web_app` inline buttons from `miniAppBaseUrl`.
- `defaultMiniAppBaseUrl()` prefers `HAPPYTG_MINIAPP_URL`, then `HAPPYTG_APP_URL`, then `HAPPYTG_PUBLIC_URL + /miniapp`, and finally a production HTTPS fallback.
- `.env.example` uses local HTTP URLs, so local dev can derive non-HTTPS Mini App launch URLs unless the bot suppresses Web App buttons.
- `apps/bot/src/index.ts` already bounds the Windows Node sendMessage attempt and uses PowerShell fallback. This task must preserve that latency behavior.

## Open Evidence Questions

- Does text-only `sendMessage` succeed through Windows PowerShell fallback?
  - Yes. `raw/telegram-powershell-probes-sanitized.json` and `raw/text-only-sendmessage.txt` show HTTP 200, `ok=true`, and the probe message was deleted after the probe.
- Does callback-only reply markup succeed?
  - Yes. `raw/callback-markup-sendmessage.txt` shows HTTP 200, `ok=true`, and the probe message was deleted after the probe.
- Does local HTTP `web_app.url` reproduce Telegram HTTP 400?
  - Yes. `raw/local-webapp-markup-sendmessage.txt` shows HTTP 400 for `http://localhost:4000/miniapp?screen=home`.
- What exact Telegram JSON description is available for that 400?
  - `Bad Request: inline keyboard button Web App URL 'http://localhost:4000/miniapp?screen=home' is invalid: Only HTTPS links are allowed`.
- Does public HTTPS `web_app.url` preserve expected payload rendering?
  - Yes. `raw/https-webapp-markup-sendmessage.txt` shows HTTP 200 for `https://example.com/miniapp?screen=home`, and `raw/postfix-handler-webapp-payloads.json` shows HappyTG still renders HTTPS `web_app` buttons.

## Root Cause

The failure is caused by invalid Telegram Web App URLs, not by `chat_id`, message text, or callback-only reply markup. The pre-fix handler payload in `raw/current-handler-env-derived-payload.json` proves the local `.env` values resolved the main menu Web App button to `http://localhost:3001/?screen=home`. Telegram rejects equivalent local HTTP Web App buttons with the exact rule above: only HTTPS links are allowed.

## Fix Evidence

- `apps/bot/src/handlers.ts` now validates Telegram Web App URLs before adding `web_app` buttons.
- Local HTTP, localhost, private-network, malformed, or missing Mini App URLs omit only the Web App launch button and keep ordinary callback controls.
- `apps/bot/src/handlers.ts` no longer uses a hidden production fallback when no Mini App URL is configured.
- `apps/bot/src/index.ts` adds `miniAppLaunch` readiness/startup diagnostics that explain buttons are disabled until `HAPPYTG_MINIAPP_URL` or `HAPPYTG_APP_URL` points to a public HTTPS `/miniapp` URL.
- `apps/bot/src/index.ts` changes the Windows sendMessage fallback to use `HttpClient`, so HTTP 400 responses include Telegram JSON descriptions when available.

## Verification

- `raw/test-unit.txt`: `pnpm --filter @happytg/bot run test` passed, 32 tests.
- `raw/typecheck.txt`: `pnpm --filter @happytg/bot run typecheck` passed.
- `raw/build.txt`: `pnpm --filter @happytg/bot run build` passed.
- `raw/lint.txt`: `pnpm --filter @happytg/bot run lint` passed.
- `raw/fresh-verifier.txt`: fresh verifier pass ran `git diff --check`, bot tests, and bot typecheck; all passed.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-04-22-telegram-sendmessage-400-webapp-url` passed.
