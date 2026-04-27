# HTG-2026-04-28-session-cancel-from-bot

## Scope

Add a minimal control-plane session cancel flow reachable from the Telegram bot.

## Acceptance Criteria

- Telegram session cards show `Остановить` / `Cancel` only for non-terminal sessions.
- Bot accepts callback data `s:c:<sessionId>`, calls the control-plane cancel API, and renders the updated card or a clear error.
- API exposes `POST /api/v1/sessions/:id/cancel`.
- Cancelling a non-terminal session transitions it to `cancelled`.
- Cancelling a terminal session is safe and does not break terminal state.
- Cancel writes a session event and audit record.
- Existing dispatch/control mechanisms are used if available; otherwise evidence documents runtime kill limitation.
- Bot callback contracts docs are updated.
- Targeted bot and API/service tests cover cancel button, callback, transition, and terminal behavior.

## Out Of Scope

- Broad bot UI redesign.
- Runtime process killing unless an existing safe dispatch/control mechanism is already present.
- Mini App session controls.
- Large refactors of API routing, store shape, or session engine.

## Verification Plan

- `pnpm lint`
- `pnpm typecheck`
- Targeted `pnpm test` for API/service/bot/session changes
- `pnpm happytg verify` if environment allows
