# Evidence

Spec frozen before implementation.

## Scope Implemented

- Added `POST /api/v1/sessions/:id/cancel`.
- Added service cancel transition for non-terminal sessions to `cancelled`.
- Cancel marks non-terminal pending dispatch records as `cancelled`, which prevents queued dispatches from being returned by daemon poll.
- Cancel appends `SessionCancelled` session event and `session.cancelled` audit record.
- Terminal sessions use idempotent no-op behavior.
- Host completion after a terminal session no longer rewrites terminal state.
- Telegram session cards show `Остановить` only for non-terminal sessions.
- `/sessions` active-session list also shows `Остановить` next to each active session.
- Telegram callback `s:c:<sessionId>` posts cancel and re-renders the updated session card.
- Bot callback docs were updated in `docs/architecture/bot-first-ux.md`.

## Runtime Cancel Limitation

The current host/worker/runtime path has queued dispatch polling, dispatch ack/completion, and a `session.control` message type in protocol, but no implemented host polling channel or runtime adapter API that can kill an already-running Codex process safely.

This change therefore implements the minimal safe control-plane cancel:

- queued dispatches are marked `cancelled` and will not be delivered by `/api/v1/daemon/poll`;
- active session state becomes `cancelled`;
- running/acked dispatch records are marked `cancelled`, but no OS/runtime process kill is attempted;
- if a host reports completion after control-plane cancellation, the session remains terminal `cancelled`.

Follow-up: add a daemon-visible control message or runtime adapter cancellation API before attempting runtime-level kill.

## Commands

- `pnpm --filter @happytg/api test` -> pass, 20 tests. Raw: `raw/test-api.txt`.
- `pnpm --filter @happytg/bot test` -> pass, 47 tests. Raw: `raw/test-bot.txt`.
- `pnpm --filter @happytg/bot lint` -> pass. Raw: `raw/lint-bot.txt`.
- `pnpm --filter @happytg/session-engine test` -> pass, 4 tests. Raw: `raw/test-session-engine.txt`.
- `pnpm --filter @happytg/protocol test` -> pass, 3 tests. Raw: `raw/test-protocol.txt`.
- `pnpm lint` -> pass, 15/15 tasks. Raw: `raw/lint.txt`.
- `pnpm typecheck` -> pass, 15/15 tasks. Raw: `raw/typecheck.txt`.
- `pnpm build` -> pass, 15/15 tasks. Raw: `raw/build.txt`.
- `pnpm happytg verify` -> exit 0 with WARN findings unrelated to this change: Codex websocket 403 fallback and public Caddy Mini App route identity mismatch. Raw: `raw/verify.txt`.

## Fresh Verify Notes

Initial fresh lint/typecheck found `TS2440` from importing `isTerminalSessionState` where API service already had a local helper. Minimal fix removed the duplicate import. Repeated lint/typecheck and targeted tests passed.
