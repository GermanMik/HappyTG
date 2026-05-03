# Problems

## Fresh Verifier 1

- Blocking: proof metadata was still pending after implementation. `evidence.md`, `evidence.json`, and `verdict.json` did not yet reflect verification results.
- Resolution: updated proof metadata and reran required checks after the final bot copy fix.

## Deferred By Scope

- No release/version bump was requested.
- No new Codex Desktop action support is introduced; unsupported actions remain truthful.
- No framework migration or Mini App route architecture change.

## Residual Operational Warnings

- `pnpm happytg doctor` and `pnpm happytg verify` exit 0 with WARN because Codex Responses websocket returned 403 Forbidden and the CLI fell back to HTTP.
- The same commands report already-running HappyTG services on Mini App 3007, API 4000, and Bot 4100. This is reuse guidance, not a test failure.
