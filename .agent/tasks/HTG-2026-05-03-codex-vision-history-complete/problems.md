# HTG-2026-05-03 Codex Vision History Complete Problems

## Open

- None.

## Resolved

- Confirmed gap: Desktop session detail used list metadata only; no source-aware Desktop detail/history API existed.
- Added bounded sanitized Desktop history preview through runtime adapter, API, and Mini App.
- Telegram Bot now directs Desktop history inspection to Mini App without dumping transcripts into chat.
- Desktop mutating actions remain unsupported by default with `CODEX_DESKTOP_CONTROL_UNSUPPORTED`.
- Task validator initially reported missing `raw/build.txt`; `pnpm build` was run and task validation now passes.
- Fresh verifier returned PASS with no blocking findings.
- PR CI initially exposed an API test cleanup race (`ERR_SERVER_NOT_RUNNING` on double close); the test harness was fixed and local raw checks were refreshed.
