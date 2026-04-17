# Problems

## Reproduced And Resolved

1. `pnpm test` fails in two bootstrap installer regression tests because they read the maintainer machine's real local daemon state and therefore stop expecting a manual pairing-code step.
   - Resolution: both tests now write repo-local `.env` with `HAPPYTG_STATE_DIR` pointing at a temp directory, so they remain hermetic regardless of the maintainer machine's persisted host state.

## Not Reproduced As Product Bugs

- The current Codex websocket `403 Forbidden` warning is coherent across `setup/doctor/verify/repair` and is treated as a warning with HTTP fallback, not a hard failure.
- Current port reuse/conflict diagnostics are consistent and actionable.
- Current install-time Telegram `invalid_token` result is a truthful live-environment constraint, not a stale artifact.
