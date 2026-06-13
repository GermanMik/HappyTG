# HTG-2026-06-13-dev-userid-codex-desktop

## Scope

Fix local/test Mini App links that use `userId=usr_1` so read-only Codex Desktop project/session projections do not render `CODEX_DESKTOP_USER_NOT_FOUND` warnings outside production.

## Acceptance Criteria

- `usr_1` is accepted only as an explicit non-production read-only Codex Desktop projection hint.
- Unknown non-demo user ids still return `CODEX_DESKTOP_USER_NOT_FOUND`.
- Codex Desktop mutating actions still require a real active user from the control-plane store.
- Relevant API tests pass.

## Non-goals

- Do not weaken production Mini App session authentication.
- Do not expose generic public API routes.
- Do not change Codex Desktop mutation or policy semantics.
