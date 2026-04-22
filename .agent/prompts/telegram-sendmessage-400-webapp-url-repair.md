# Telegram sendMessage 400 Web App URL Repair Prompt

Use this prompt when `pnpm dev` starts successfully, Telegram polling is active, but outbound bot replies fail with `Telegram sendMessage failed` where Node times out and the Windows PowerShell fallback returns HTTP 400 Bad Request.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Your task is to diagnose and repair the current Telegram outbound reply failure:

```text
@happytg/bot:dev: {"level":"ERROR","scope":"bot","message":"Telegram sendMessage failed","metadata":{"nodeTransport":{"message":"Node HTTPS sendMessage exceeded 1500ms before Windows fallback.","code":"HAPPYTG_TELEGRAM_NODE_TIMEOUT"},"fallbackStatus":400,"fallbackMessage":"The remote server returned an error: (400) Bad Request."}}
```

Follow the repository proof-loop discipline strictly:

1. Retrieve EchoVault context first:
   - `memory context --project`
   - `memory search "Telegram sendMessage 400 web_app localhost fallback"`
   - fetch details for relevant results.
2. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` with:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `task.json`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
3. Freeze scope before production edits.
4. Keep builder and verifier roles separate.
5. Do not mark complete without a fresh verifier pass and task validation.

Recommended task id: `HTG-2026-04-22-telegram-sendmessage-400-webapp-url`.

## Current Known Context

- `pnpm dev` starts API, worker, Mini App, host daemon, and bot.
- The bot reaches Telegram via the existing Windows PowerShell fallback:
  - `deleteWebhook delivered via Windows PowerShell fallback`
  - `Telegram polling active`
  - `getUpdates delivered via Windows PowerShell fallback`
- A previous bounded fix intentionally made Windows `sendMessage` fall back after about 1500 ms when Node HTTPS hangs. Do not redo that latency fix unless evidence proves it regressed.
- The new symptom is different: PowerShell reaches Telegram, but Telegram rejects the `sendMessage` payload with HTTP 400.
- `apps/bot/src/handlers.ts` builds inline `web_app` buttons from:
  - `HAPPYTG_MINIAPP_URL`
  - `HAPPYTG_APP_URL`
  - or `HAPPYTG_PUBLIC_URL` + `/miniapp`
- In local dev, `HAPPYTG_PUBLIC_URL` is often `http://localhost:4000`, which can produce `web_app.url` values like `http://localhost:4000/miniapp?screen=home`.
- Telegram Web App URLs must be public HTTPS URLs. A local HTTP `web_app.url` is a likely cause of HTTP 400 for `/start`, `/menu`, and other replies that attach Mini App buttons.
- The current fallback log may be too generic because it reports the PowerShell exception text instead of the Telegram JSON `description`.

Treat the HTTPS Web App URL hypothesis as a hypothesis, not a conclusion. Prove or falsify it with evidence.

## Goal

Make local Telegram bot replies work again while preserving Mini App launch behavior when a valid public HTTPS Mini App URL is configured.

The finished repair must:

1. identify the exact payload or Telegram validation rule causing HTTP 400;
2. prevent local/non-public Mini App URLs from breaking ordinary bot replies;
3. keep valid HTTPS `web_app` buttons working;
4. keep errors truthful and improve diagnostics if Telegram rejects a payload;
5. avoid weakening pairing, auth, approval, policy, or delivery-mode semantics.

## Required Investigation Scope

Inspect and test these areas:

1. Outbound send path
   - `apps/bot/src/index.ts`
   - `createDefaultSendTelegramMessage()`
   - `sendTelegramMessageViaWindowsPowerShell()`
   - fallback logging and parsing of Telegram error bodies

2. Reply markup generation
   - `apps/bot/src/handlers.ts`
   - `defaultMiniAppBaseUrl()`
   - `miniAppUrl()`
   - all keyboards that include `web_app`

3. Local environment derivation
   - sanitized `HAPPYTG_PUBLIC_URL`
   - sanitized `HAPPYTG_MINIAPP_URL`
   - sanitized `HAPPYTG_APP_URL`
   - bot `/ready` output
   - docs or setup guidance that may lead users to local HTTP Mini App URLs

4. Telegram API behavior
   - text-only `sendMessage`
   - `sendMessage` with callback-only inline keyboard
   - `sendMessage` with local HTTP `web_app.url`
   - `sendMessage` with public HTTPS `web_app.url`

Do not record bot tokens, raw credentials, or private user data in evidence.

## Explicit Questions To Answer

Your evidence must answer:

1. Does text-only `sendMessage` succeed through the Windows PowerShell fallback on this host?
2. Does callback-only reply markup succeed?
3. Does the failing payload contain a `web_app.url` derived from localhost or another non-HTTPS/non-public URL?
4. What exact Telegram `description` is returned for the HTTP 400 rejection?
5. Is the failure caused by invalid `web_app` URL, invalid `chat_id`, malformed `reply_markup`, message text, or another Telegram rule?
6. What should HappyTG do in local dev when Mini App cannot be launched from Telegram because no public HTTPS URL is configured?

## Expected Fix Shape

Prefer the smallest repair that keeps the bot useful in local dev:

- Add a reusable validation/helper path for Telegram Web App URLs.
- Only include `web_app` buttons when the resolved Mini App URL is HTTPS and suitable for Telegram.
- For local HTTP, localhost, private-network, or malformed Mini App URLs, keep bot replies functional by rendering callback-only controls or omitting only the Mini App button.
- Surface a truthful diagnostic in logs and/or readiness output that explains Mini App launch buttons are disabled until `HAPPYTG_MINIAPP_URL` or `HAPPYTG_APP_URL` points to a public HTTPS `/miniapp` URL.
- Improve PowerShell fallback error reporting so HTTP 400 logs include Telegram's JSON `description` when available.

Do not hardcode the production URL as a hidden fallback for local dev. If no valid HTTPS Mini App URL is configured, the bot should still reply and the Mini App button should be absent or replaced with a non-WebApp control.

## Suggested Tests

Add focused regression coverage, likely in `apps/bot/src/handlers.test.ts` and `apps/bot/src/index.test.ts`:

- `mainMenuKeyboard` or handler flow with `miniAppBaseUrl: "http://localhost:4000/miniapp"` does not emit any `web_app` button.
- The same flow with `miniAppBaseUrl: "https://happy.example/miniapp"` still emits `web_app` buttons.
- Session, approvals, reports, and callback detail flows do not emit invalid local HTTP `web_app` buttons.
- `createDefaultSendTelegramMessage()` logs a parsed Telegram 400 description from the PowerShell fallback when available.
- Existing Windows fallback timeout tests still pass.

If the code currently keeps keyboard helpers private, add tests through public handler behavior rather than exporting internals just for tests, unless a small export matches existing style.

## Recommended Evidence To Capture

Add artifacts such as:

- `raw/init-analysis.txt`
- `raw/live-ready.txt`
- `raw/env-url-summary.txt`
- `raw/failing-sendmessage-log.txt`
- `raw/failing-payload-sanitized.json`
- `raw/text-only-sendmessage.txt`
- `raw/callback-markup-sendmessage.txt`
- `raw/local-webapp-markup-sendmessage.txt`
- `raw/https-webapp-markup-sendmessage.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/typecheck.txt`
- `raw/build.txt`
- `raw/lint.txt`
- `raw/task-validate.txt`
- `raw/fresh-verifier.txt`

## Verification Requirements

At minimum run and record:

- `pnpm --filter @happytg/bot run test`
- `pnpm --filter @happytg/bot run typecheck`
- `pnpm --filter @happytg/bot run build`
- `pnpm --filter @happytg/bot run lint`
- `pnpm happytg task validate --repo . --task <TASK_ID>`

If docs, setup, shared URL helpers, API readiness, or installer diagnostics change, expand verification to the relevant package tests plus repo-level:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg verify`

## Completion Criteria

Do not mark complete until the proof bundle demonstrates:

1. the root cause of the 400 is proven with sanitized payload and Telegram description evidence, or an equally strong local reproduction;
2. local `/start` or `/menu` replies no longer fail just because no public HTTPS Mini App URL is configured;
3. HTTPS Mini App buttons still render when explicitly configured;
4. Telegram rejection logs are more actionable than a generic `Bad Request`;
5. all required verification is green;
6. a fresh verifier pass confirms the repair and the task bundle is complete.
