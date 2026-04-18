# Evidence Summary

## Acceptance Criteria Mapping

| Local bot runtime receives Telegram messages without an externally configured webhook. | `apps/bot/src/index.ts` now auto-selects polling for local `HAPPYTG_PUBLIC_URL` values, clears any prior webhook with `deleteWebhook`, and consumes `getUpdates`; `raw/manual-mode.txt` confirms the current local env resolves to `polling`. |
| Webhook mode remains available for deployed setups without double-processing updates. | `resolveTelegramUpdateMode()` selects `webhook` for public URLs and accepts `TELEGRAM_UPDATES_MODE=webhook`; startup logs now state which delivery mode the bot expects. |
| Regression coverage proves incoming Telegram updates are polled and dispatched to existing handlers. | `apps/bot/src/index.test.ts` adds polling mode selection coverage and a polling runtime test that verifies `deleteWebhook` plus `getUpdates` dispatch; `raw/test-unit.txt` and `raw/test-integration.txt` are green. |

## Artifacts

- raw/manual-mode.txt
- raw/typecheck.txt
- raw/lint.txt
- raw/test-unit.txt
- raw/test-integration.txt
- raw/build.txt
- raw/task-validate.txt
- apps/bot/src/index.ts
- apps/bot/src/index.test.ts
- apps/bot/src/handlers.ts
- .env.example
- docs/configuration.md
