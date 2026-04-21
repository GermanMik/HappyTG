# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Silent Telegram symptom was traced to replayed failing updates rather than transport selection or token validity. | `raw/init-analysis.txt` records that local config resolves to polling, direct Node HTTPS `getMe` still fails on this Windows host, and PowerShell Bot API `getMe` succeeds with the configured token. `raw/live-ready-before.txt` shows the live bot was degraded by `/api/v1/pairing/claim` returning `Pairing code expired`, not by Telegram transport selection. |
| One failing update no longer blocks later updates. | [apps/bot/src/index.ts](C:/Develop/Projects/HappyTG/apps/bot/src/index.ts:1057) now isolates per-update handler failures, logs them, and still advances the Telegram offset in `finally`. |
| Telegram readiness reflects Telegram delivery, not command handler failures. | `raw/live-ready-before.txt` captured the pre-fix poisoned state, while `raw/live-ready-after.txt` shows the watched live bot recovered to `200 ready` after reloading the fix without changing delivery mode or token configuration. |
| Regression coverage proves later updates still run after a handler failure. | `raw/test-unit.txt` includes `local polling mode skips a failing update and continues with later updates`, which asserts offsets move from `0` to `403`, only one `/api/v1/pairing/claim` call is made, and a later `/start` still sends the help reply. |
| Bot-scope verification passed. | `raw/test-unit.txt`, `raw/typecheck.txt`, and `raw/build.txt` all passed on the patched bot package. |

## Build Notes

- Commands executed:
  - `pnpm --filter @happytg/bot run test`
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
- Key outputs:
  - Bot tests passed: `25` passing.
  - The new regression proved a stale `/pair` failure does not poison the polling loop.
  - Typecheck passed with no errors.
  - Build passed with no errors.
  - The existing watched bot process on port `4100` reloaded the change and `/ready` moved from degraded `503` to healthy `200`.

## Residual Risk

- If the bot is run from a non-watch process, that process still needs a restart to pick up the fix.
- The API still reports expired pairing codes as `500 Internal server error`; this task intentionally did not widen scope into API status-code redesign.
- A failed command update is now skipped and logged rather than retried forever; if product requirements later demand explicit user-facing error replies for these cases, that should be implemented as a separate bounded UX task.
