# Spec

Task: `HTG-2026-06-12-desktop-sessions-timeout`

## Scope

Fix misleading Mini App `Desktop sessions unavailable: This operation was aborted` warning for normal bounded Codex Desktop session list latency.

## Acceptance Criteria

- Default Mini App Desktop/Codex fallback timeout covers current live bounded `/sessions?limit=50` latency.
- AbortError text is normalized before rendering into warning UI.
- Existing bounded fallback behavior remains in place for genuinely slow/unavailable Desktop data.
- Scoped Mini App validation passes.

## Out of Scope

- Reworking Desktop session pagination/search.
- Changing Codex Desktop adapter API contracts.
- Relaxing user/auth checks.
