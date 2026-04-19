# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Current bot runtime and config requirements were proven on `main`. | `raw/init-analysis.txt` shows that `.env` resolves to local polling (`HAPPYTG_PUBLIC_URL=http://localhost:4000`, `TELEGRAM_UPDATES_MODE=auto`) and that current `apps/bot/src/index.ts` already chose `polling`, so the remaining bug was not delivery-mode selection. |
| The silent `/start` symptom was traced to a deterministic root cause. | `raw/node-telegram-fetch.txt` proves Node HTTPS to Telegram fails on this Windows host with `UND_ERR_CONNECT_TIMEOUT`, while `raw/powershell-telegram-fetch.txt` proves PowerShell Bot API access succeeds with the same token. |
| A bounded runtime fix preserves the explicit delivery-mode model. | `apps/bot/src/index.ts` now keeps `auto|polling|webhook` unchanged and adds a Windows PowerShell Bot API fallback only for transport-level failures in `telegramApiCall()`. |
| The fix is covered by deterministic regression tests. | `raw/test-unit.txt` includes `local polling mode falls back to Windows PowerShell Bot API calls after a Node transport timeout`, `polling mode stays degraded with actionable detail when both Telegram transports fail on Windows`, and `webhook inspection falls back to Windows PowerShell Bot API calls after a Node transport timeout`. |
| The new runtime works on the current machine. | `raw/live-runtime.txt` shows an ephemeral runtime starting in `polling/ready` on this Windows host and logging `Telegram deleteWebhook delivered via Windows PowerShell fallback`. |

## Build Notes

- Commands executed:
  - `pnpm --filter @happytg/bot run test`
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-19-telegram-start-still-silent`
- Key outputs:
  - Bot test suite passed with 20 tests, including new Windows transport fallback coverage for polling and webhook inspection.
  - Bot `typecheck` and `build` passed without errors.
  - Live startup with the new code on this host reached `polling/ready` through the PowerShell Bot API fallback.
  - The pre-existing bot process on `4100` remained stale until restart, so it continued surfacing degraded `/ready` output from the old runtime state.

## Residual Risk

- Existing already-running bot processes must be restarted to pick up the fixed runtime; the repo change does not hot-swap a process that was already launched from older code.
- If both Node HTTPS and PowerShell Bot API access are blocked on a Windows host, the bot will still stay degraded, but now with actionable diagnostics instead of a raw `fetch failed`.
- The fix intentionally does not broaden into automatic webhook provisioning or Telegram auth changes.
