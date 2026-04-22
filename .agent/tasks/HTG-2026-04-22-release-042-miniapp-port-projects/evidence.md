# Evidence

## Implementation

- Fixed Mini App HTML routes to send `text/html`.
- Added Mini App Projects/workspaces view and authenticated Codex CLI session creation from a selected project.
- Added Codex CLI runtime visibility to Mini App session cards and detail pages.
- Added API Mini App endpoints for project listing and session creation, both requiring Mini App user context.
- Separated Docker Compose Mini App host port from container port and made Caddy Mini App upstream configurable.
- Updated installer port-conflict save path so a selected Mini App port also refreshes local `HAPPYTG_APP_URL` and `HAPPYTG_DEV_CORS_ORIGINS`.
- Updated release metadata, docs, and release notes for `0.4.2`.

## Evidence Files

- `raw/browser-verify.txt`
- `raw/happytg-projects.png`
- `raw/happytg-sessions.png`
- `raw/live-store-codex-sessions.json`
- `raw/test-unit.txt`
- `raw/typecheck.txt`
- `raw/lint.txt`
- `raw/test-integration.txt`
- `raw/build.txt`
- `raw/release-check.txt`
- `raw/task-validate.txt`

## Notes

The local `.env` observed during this task had `HAPPYTG_MINIAPP_PORT=3007` but `HAPPYTG_APP_URL=http://localhost:3001`; the installer fix prevents that drift for future interactive port selections. Operators should update existing local `.env` files manually if they already contain the mismatch.
