# HTG-2026-05-03 Codex Vision/Control Repair Problems

## Open

None.

## Resolved

- Second fresh verifier pass confirmed no implementation blocker and found only terminal proof status fields, which are now closed.
- Full required verification commands were captured in `raw/` with exit 0.
- First fresh verifier pass reviewed proof bundle and code changes, found no production-code blocker, and identified stale proof metadata only.
- Desktop mutating control was revalidated. Local `codex app-server` and `exec-server` are explicitly experimental, so no stable production Desktop mutating contract was proven.
- Default Codex Desktop Resume/Stop/New Task now remain unsupported with `CODEX_DESKTOP_CONTROL_UNSUPPORTED`, API status 501, audit records, disabled UI, and tests.
- Experimental app-server JSON-RPC remains testable only as an explicitly injected contract, not default production behavior.
- Mini App and Telegram Bot explicitly distinguish Codex Desktop and Codex CLI and render Desktop unsupported reason codes.
- Desktop action kinds are classified as serial mutations; API service also serializes injected/proven Desktop mutating calls.
