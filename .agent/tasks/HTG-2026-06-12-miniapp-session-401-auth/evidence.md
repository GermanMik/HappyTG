# Evidence

Task: `HTG-2026-06-12-miniapp-session-401-auth`

## Finding

The Mini App SSR session-detail routes used strict `fetchForRequest`. When API returned `401` for `/api/v1/miniapp/sessions/:id`, the error escaped into the shared HTTP error handler and rendered JSON `500 Internal server error`.

## Change

- Added an optional `onError` hook to `createJsonServer`.
- Mini App now maps `GET` `MiniAppFetchError` status `401` to the existing auth-pending bridge page.
- Added regression coverage for `/session/:id` and legacy `/?screen=session&id=...`.
- POST behavior is unchanged.

## Validation

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm --filter @happytg/miniapp test` | `raw/test-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp typecheck` | `raw/typecheck-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp lint` | `raw/lint-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp build` | `raw/build-miniapp.txt` | PASS |
| `pnpm --filter @happytg/shared test` | `raw/test-shared.txt` | PASS |
| `pnpm --filter @happytg/shared typecheck` | `raw/typecheck-shared.txt` | PASS |
| `pnpm --filter @happytg/shared lint` | `raw/lint-shared.txt` | PASS |
| `pnpm --filter @happytg/shared build` | `raw/build-shared.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml ps api miniapp` | `raw/docker-ps.txt` | PASS |
| Live local `/session/ses_3b15800fe9b8464b9968da30` smoke | `raw/live-local-session-401-smoke.json` | PASS |
| Live public `/miniapp/session/ses_3b15800fe9b8464b9968da30` smoke | `raw/live-public-session-401-smoke.json` | PASS |
| `pnpm happytg task validate --repo . --task HTG-2026-06-12-miniapp-session-401-auth` | `raw/task-validate.txt` | PASS |
| `pnpm release:check --version 0.4.22` | `raw/release-check-0.4.22.txt` | PASS |
| `graphify query "Mini App session detail 401 auth bridge createJsonServer onError" --budget 1200` | `raw/graphify-query-session-401-auth.txt` | PASS |

## Fresh Verifier

- Verdict: PASS.
- Blocking findings: none from scoped unit/type/build validation.
- Local and public live smoke returned `200 text/html` with auth bridge and without `Internal server error` or `Mini App fetch failed`.
- Release metadata for `0.4.22` passed validation.
- Graphify query evidence was captured for the Mini App session-detail/auth error path.
