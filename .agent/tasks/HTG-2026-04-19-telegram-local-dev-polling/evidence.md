# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Root cause and misleading local UX were proven before the fix. | `raw/init-analysis.txt` captures the pre-fix startup path, the absence of `getUpdates`/polling, and the docs/runtime mismatch across `apps/bot/src/index.ts`, `docs/quickstart.md`, `docs/installation.md`, `docs/self-hosting.md`, and `docs/engineering-blueprint.md`. |
| Delivery-mode selection is explicit and deterministic. | `apps/bot/src/index.ts` now resolves `auto|polling|webhook` through `resolveTelegramDeliveryMode()` and exposes the current delivery snapshot through runtime logging and `/ready`; covered by `resolveTelegramDeliveryMode` tests in `raw/test-unit.txt`. |
| Local development can receive Telegram commands without a public webhook. | `raw/test-unit.txt` includes `local polling mode receives /start without a public webhook` and `local polling mode receives /pair and preserves the pairing claim API boundary`, both running through the polling path with the shared dispatcher. |
| Webhook mode remains available and honest when misconfigured. | `raw/test-unit.txt` includes `webhook endpoint dispatches updates through the shared bot handlers` and `webhook mode stays separate from polling and reports degraded readiness when Telegram webhook is not configured`. |
| No accidental mixed-mode duplicate processing is introduced. | `apps/bot/src/index.ts` starts polling only when the resolved mode is polling, inspects webhook only when the resolved mode is webhook, and disables webhook delivery at Telegram before polling; the webhook-mode regression test confirms no `deleteWebhook/getUpdates` calls are made in webhook mode. |
| Docs and config are synchronized with runtime reality. | `.env.example`, `docs/configuration.md`, `docs/quickstart.md`, `docs/installation.md`, and `docs/self-hosting.md` now describe `TELEGRAM_UPDATES_MODE`, local auto/polling behavior, webhook-first stable deployments, and degraded delivery guidance. |

## Build Notes

- Commands executed:
  - `pnpm --filter @happytg/bot run test`
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
  - `pnpm --filter @happytg/bot run lint`
  - `pnpm test`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-19-telegram-local-dev-polling`
- Key outputs:
  - Bot test suite passed with 17 tests, including new coverage for local polling `/start`, local polling `/pair`, webhook dispatch, delivery-mode resolution, and webhook-mode separation.
  - Bot `typecheck` and `build` passed without errors.
  - Repo-wide `pnpm test` passed across all 13 packages in scope.
  - Task-bundle validation returned `Validation: ok`.
- Process discipline:
  - Work followed a frozen-spec proof loop with repo-local evidence first, build second, then verifier-driven minimal fix on bundle artifacts.
  - The external discipline references requested by the task were used as workflow guidance for spec freeze, bounded changes, and fresh verification, not as substitutes for repository evidence.

## Residual Risk

- Webhook provisioning remains explicit. The runtime now diagnoses missing or mismatched webhook state, but it does not auto-call `setWebhook`.
- `TELEGRAM_WEBHOOK_SECRET` remains documented but is still not enforced by the bot runtime; this task preserved the existing webhook path instead of introducing a potentially breaking migration in the same fix.
- Polling mode depends on Telegram Bot API reachability. The runtime now reports degraded readiness instead of pretending to be healthy when delivery is broken.
