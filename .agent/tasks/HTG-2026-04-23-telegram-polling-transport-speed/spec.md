# HTG-2026-04-23-telegram-polling-transport-speed

## Scope

Diagnose and optimize the HappyTG bot Telegram polling/control-plane transport path on Windows hosts where Node HTTPS to `api.telegram.org` is slow or timing out while the existing Windows PowerShell Bot API fallback can succeed.

Primary implementation area:

- `apps/bot/src/index.ts`
- `apps/bot/src/index.test.ts`

## Acceptance Criteria

1. Evidence answers the eight explicit timing/behavior questions from the task prompt.
2. The bottleneck is proven by repo-local tests or live/synthetic timing artifacts before changing production code.
3. The fix is limited to Telegram transport/runtime timing behavior for methods that already support Windows PowerShell fallback.
4. Node HTTPS support remains available and Telegram HTTP/API rejections such as 400/401/403 remain truthful without fallback masking.
5. Explicit webhook mode still inspects `getWebhookInfo` and does not silently switch to polling.
6. Existing `sendMessage` 1500 ms Windows fallback behavior remains covered and unchanged.
7. Both-transports-fail behavior still reports degraded polling/readiness with actionable detail.
8. Proof bundle includes before/after timing evidence, regression tests, fresh verifier output, and passing task validation.

## Out Of Scope

- Mini App launch URL, menu button, reply-markup, pairing, approval, policy, or handler redesign.
- Making PowerShell mandatory outside Windows.
- Removing Node HTTPS globally.
- Swallowing Telegram API errors or authentication failures.
- Changing shared packages unless evidence proves they are the active bottleneck.

## Required Verification

Minimum commands:

```powershell
pnpm --filter @happytg/bot run test
pnpm --filter @happytg/bot run typecheck
pnpm --filter @happytg/bot run build
pnpm --filter @happytg/bot run lint
pnpm happytg task validate --repo . --task HTG-2026-04-23-telegram-polling-transport-speed
```

Record command output under `raw/`.

## Frozen

Spec frozen before production edits on 2026-04-23.
