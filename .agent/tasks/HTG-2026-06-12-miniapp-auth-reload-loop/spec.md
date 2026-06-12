# Spec

Task: `HTG-2026-06-12-miniapp-auth-reload-loop`

## Scope

Fix the Mini App session detail loading loop where a stale local Mini App session can make the auth bridge repeatedly reload instead of reconnecting through Telegram.

## Acceptance Criteria

- Session detail `401` from the API renders the auth bridge, not JSON/internal errors.
- The auth bridge produced after a `401` clears stale Mini App session state before any saved-session reload path can run.
- The response expires the Mini App session cookie for the current Mini App base path.
- Existing Mini App session, Codex, Desktop, and auth bridge tests stay green.
- Release metadata is prepared for `0.4.24`.

## Out Of Scope

- Changing Telegram auth contracts.
- Changing Mini App session TTLs.
- Changing Codex Desktop adapter behavior.
- Adding pagination/search to Desktop sessions.
