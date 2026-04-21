# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Required proof bundle exists and is valid. | `spec.md`, `task.json`, `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, and the `raw/` artifacts exist under `.agent/tasks/HTG-2026-04-20-telegram-e2e-latency-audit/`. `raw/task-validate.txt` records `Validation: ok`. |
| Fresh evidence proves where latency lives and answers the explicit transport questions. | `raw/live-health.txt` and `raw/live-ready.txt` show local API and bot readiness are sub-second and currently `polling`/`ready`. `raw/polling-smoke.txt` proves a mocked polling path dispatches update `901` in ready polling mode. `raw/node-getme-timing.txt` and `raw/sendmessage-node-timing.txt` show direct Node HTTPS to Telegram fails after about `10.7s` with `UND_ERR_CONNECT_TIMEOUT`, while `raw/powershell-getme-timing.txt` and `raw/sendmessage-fallback-timing.txt` show the Windows PowerShell path works or fails fast in about `0.5s` to `0.6s`. `raw/before-latency.txt` proves the current outbound reply path spent `10646.5ms` in Node, `0.4ms` transitioning to fallback, `598.4ms` in fallback, and `11245.5ms` total before the fix. `raw/webhook-smoke.txt` shows a local `/telegram/webhook` `/start` request returned only after `11506.5ms`, so the handler was blocked on outbound send latency rather than inbound delivery. |
| The product change is bounded and preserves delivery semantics and boundaries. | The bounded repair is localized to `apps/bot/src/index.ts` around `createDefaultSendTelegramMessage`, adding a Windows-only pre-fallback Node timeout and leaving `auto|polling|webhook`, `/api/v1/pairing/claim`, approvals, and readiness semantics intact. No delivery-mode logic, pairing API behavior, or approval/user-binding logic was changed in this task. |
| Regression coverage proves the repaired latency behavior. | `apps/bot/src/index.test.ts` adds `createDefaultSendTelegramMessage bounds the Windows Node attempt before fallback`, recorded as passing in `raw/test-unit.txt`. The existing truthful HTTP failure test still passes, proving the new timeout path does not blur Telegram API rejections into fallback. |
| Fresh verification is recorded after the fix. | `raw/test-unit.txt`, `raw/typecheck.txt`, `raw/build.txt`, `raw/lint.txt`, and `raw/task-validate.txt` all passed after the code change. `raw/fresh-verifier.txt` records the separate verifier pass, which re-ran the required commands, found no blocking code defects, and only required the bundle state to be advanced from pending to passed. |

## Explicit Question Answers

1. Is the current slowness inbound delivery, bot handler logic, local API latency, outbound `sendMessage`, or a combination?
   It is primarily outbound Telegram `sendMessage` on the Node HTTPS transport. Polling is ready and dispatches updates, `/start` does not depend on local API fetches, and local `/health` and `/ready` remain sub-second.

2. If outbound delivery is slow, how much time is spent in Node attempt, fallback transition, and PowerShell call?
   `raw/before-latency.txt` measured:
   - Node attempt: `10646.5ms`
   - Fallback transition gap: `0.4ms`
   - Windows PowerShell fallback call: `598.4ms`
   - Total outbound send path: `11245.5ms`

3. Does the current `sendMessage` path wait for the full Node transport timeout before fallback?
   Yes. `raw/before-latency.txt` and `raw/sendmessage-node-timing.txt` both show the Node attempt consuming the full `~10.7s` connect timeout before fallback starts.

4. Can the response path be made materially faster with a bounded fix while preserving truthful failure handling?
   Yes. `apps/bot/src/index.ts` now caps the Windows Node `sendMessage` attempt at `1500ms` before falling back. The path still logs truthful transport metadata and still keeps direct Telegram HTTP failures out of the fallback path.

5. What is the measured before/after latency for a Telegram reply after the fix?
   - Direct send path: `11245.5ms` before -> `3167.9ms` after (`raw/before-latency.txt`, `raw/after-latency.txt`)
   - Webhook `/start` path: `11506.5ms` before -> `2135.5ms` after (`raw/webhook-smoke.txt`, `raw/after-latency.txt`)

## Build Notes

- Commands executed:
  - `pnpm --filter @happytg/bot run test`
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
  - `pnpm --filter @happytg/bot run lint`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-20-telegram-e2e-latency-audit`
- Fresh verifier commands re-run independently:
  - `pnpm --filter @happytg/bot run test`
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
  - `pnpm --filter @happytg/bot run lint`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-20-telegram-e2e-latency-audit`
- Key outputs:
  - Bot tests passed: `26` passing.
  - Typecheck passed.
  - Build passed.
  - Lint passed using the current placeholder bot lint script.
  - Task bundle validation passed.

## Residual Risk

- `telegramApiCall()` still waits for the default Node transport timeout before its Windows PowerShell fallback on control-plane calls such as `deleteWebhook` or `getWebhookInfo`. Current evidence shows that is not the live reply-latency bottleneck, so this task intentionally did not widen scope into that path.
- Windows PowerShell fallback error reporting for synthetic `sendMessage` probes still surfaces the generic old PowerShell `400 Bad Request` string on this host instead of a richer Telegram description. This does not affect fallback timing or truthful failure detection, but better 4xx detail could be a future diagnostics-only follow-up.
- Any already-running bot process must reload to pick up the new runtime behavior.
