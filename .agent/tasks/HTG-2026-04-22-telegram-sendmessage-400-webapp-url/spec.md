# Task Spec

- Task ID: HTG-2026-04-22-telegram-sendmessage-400-webapp-url
- Title: Telegram sendMessage 400 repair for local Web App URLs
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

`pnpm dev` starts the HappyTG API, worker, Mini App, host daemon, and bot. Telegram polling is active through the existing Windows PowerShell fallback, but outbound bot replies fail:

```text
Telegram sendMessage failed
nodeTransport.code=HAPPYTG_TELEGRAM_NODE_TIMEOUT
fallbackStatus=400
fallbackMessage=The remote server returned an error: (400) Bad Request.
```

The previous bounded Windows sendMessage latency fix is treated as baseline behavior and must not be redone unless evidence proves regression. The current symptom is a Telegram API payload rejection after the PowerShell fallback reaches Telegram.

Current hypothesis: inline `web_app` buttons in `apps/bot/src/handlers.ts` may be built from local/non-public URLs such as `http://localhost:4000/miniapp?screen=home`. Telegram Web App buttons require public HTTPS URLs, so local HTTP `web_app.url` values may cause `sendMessage` HTTP 400 while text-only or callback-only replies still work. This is a hypothesis until proven by sanitized payload/error evidence or strong local reproduction.

## Acceptance Criteria

1. A canonical proof bundle exists at `.agent/tasks/HTG-2026-04-22-telegram-sendmessage-400-webapp-url/` with `spec.md`, `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, `task.json`, and raw artifacts.
2. Evidence answers:
   - whether text-only `sendMessage` succeeds through the Windows PowerShell fallback on this host;
   - whether callback-only reply markup succeeds;
   - whether the failing payload contains a `web_app.url` derived from localhost or another non-HTTPS/non-public URL;
   - the exact Telegram description returned for the HTTP 400 rejection;
   - whether the root cause is invalid `web_app.url`, invalid `chat_id`, malformed `reply_markup`, message text, or another Telegram rule;
   - what HappyTG should do in local dev when Mini App launch cannot be enabled because no public HTTPS URL is configured.
3. Local/non-public Mini App URLs no longer break ordinary bot replies. Bot replies remain useful in local dev by rendering callback-only controls or omitting only Mini App launch buttons.
4. Valid public HTTPS Mini App URLs still render as Telegram `web_app` buttons.
5. Telegram rejection logs are more actionable than generic `Bad Request`; PowerShell fallback errors include the Telegram JSON description when available.
6. Pairing, auth, approval, policy, delivery-mode, and the existing Windows Node timeout/fallback semantics are not weakened.
7. Fresh builder verification and a separate fresh verifier pass are recorded, and `pnpm happytg task validate --repo . --task HTG-2026-04-22-telegram-sendmessage-400-webapp-url` passes.

## Investigation Scope

- `apps/bot/src/index.ts`
  - `createDefaultSendTelegramMessage()`
  - `sendTelegramMessageViaWindowsPowerShell()`
  - fallback logging and parsing of Telegram error bodies
- `apps/bot/src/handlers.ts`
  - `defaultMiniAppBaseUrl()`
  - `miniAppUrl()`
  - all keyboards that include `web_app`
- Local URL derivation:
  - sanitized `HAPPYTG_PUBLIC_URL`
  - sanitized `HAPPYTG_MINIAPP_URL`
  - sanitized `HAPPYTG_APP_URL`
  - bot `/ready` output
- Docs/setup guidance that may lead users to local HTTP Mini App URLs.
- Telegram API behavior:
  - text-only `sendMessage`
  - callback-only inline keyboard
  - local HTTP `web_app.url`
  - public HTTPS `web_app.url`

## Constraints

- Do not record bot tokens, raw credentials, private chat IDs, or private user data in evidence.
- Do not hardcode the production URL as a hidden fallback for local dev.
- Preserve the previous 1500 ms Windows Node sendMessage timeout behavior.
- Keep edits bounded to the send path diagnostics, Mini App URL validation/keyboards, and narrowly relevant docs/readiness diagnostics if required.
- Treat existing uncommitted workspace changes as user state and do not revert them.

## Verification Plan

Required:

- `pnpm --filter @happytg/bot run test`
- `pnpm --filter @happytg/bot run typecheck`
- `pnpm --filter @happytg/bot run build`
- `pnpm --filter @happytg/bot run lint`
- `pnpm happytg task validate --repo . --task HTG-2026-04-22-telegram-sendmessage-400-webapp-url`

Expand to repo-level verification if docs, setup, shared URL helpers, API readiness, or installer diagnostics change.

## Role Separation

- Builder role: inspect, implement the minimal repair, add focused regression tests, and record builder evidence.
- Verifier role: run a fresh post-fix review and verification pass without editing production code; record results in `raw/fresh-verifier.txt`.
