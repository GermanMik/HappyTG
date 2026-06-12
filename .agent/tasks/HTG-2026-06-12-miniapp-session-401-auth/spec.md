# Spec

Task: `HTG-2026-06-12-miniapp-session-401-auth`

## Scope

Fix Mini App SSR session-detail pages that return JSON `500 Internal server error` when the API returns `401` for `/api/v1/miniapp/sessions/:id`.

## Acceptance Criteria

- `/session/:id` renders the Mini App auth bridge when its API session-detail fetch returns `401`.
- Legacy `/?screen=session&id=...` renders the same auth bridge for `401`.
- Non-auth handler errors still use the existing structured `500` path.
- POST routes keep their existing JSON/status handling.
- Scoped Mini App and shared validation passes.

## Out of Scope

- Changing Mini App token issuance or API authorization rules.
- Relaxing session access controls.
- Reworking Telegram initData authentication.
