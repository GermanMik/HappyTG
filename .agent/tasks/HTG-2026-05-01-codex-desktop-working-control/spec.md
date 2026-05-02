# HTG-2026-05-01-codex-desktop-working-control Spec

## Frozen Scope

Bring Codex Desktop controls from guarded unsupported shell to a working implementation when a local Codex app-server contract is available.

## Acceptance

- Codex Desktop projections stay source-aware and sanitized.
- Production controls use Codex app-server JSON-RPC methods only:
  - Resume: `thread/resume`
  - New Task: `thread/start` followed by `turn/start`
  - Stop: `thread/turns/list` followed by `turn/interrupt` for an in-progress turn
- No process-kill fallback is introduced.
- Mini App browser actions do not call blocked public `/api/v1/codex-desktop/*` routes directly.
- Mini App New Task preserves Desktop project identity/path.
- Unsupported remains truthful when Codex app-server is unavailable.
- Existing policy/audit gates remain in API service.

## Out Of Scope

- Full Desktop UI focus/open-window automation.
- Raw Codex transcript/prompt/log projection.
- Broad public Caddy API exposure.
- Telegram-as-internal-transport changes.
