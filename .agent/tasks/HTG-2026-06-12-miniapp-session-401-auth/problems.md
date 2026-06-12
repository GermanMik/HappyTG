# Problems

Task: `HTG-2026-06-12-miniapp-session-401-auth`

## Resolved

- API `401` from Mini App session-detail fetch no longer becomes user-visible JSON `500`.

## Residual Risks

- This does not renew or repair invalid Mini App sessions by itself; it returns the existing auth bridge so the browser can reacquire a short-lived Mini App session.
