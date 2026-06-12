# Evidence

Task: `HTG-2026-06-12-miniapp-auth-reload-loop`

## Finding

The Mini App auth bridge can be rendered after the API returns `401` for a session detail request. Before this fix, that page still allowed the client bootstrap to read a previously persisted `happytg:miniapp:session:v1` value, write it back to the cookie, and immediately call `location.reload()` because `window.HAPPYTgNeedsAuth` was true.

That created a reload loop when the browser had stale localStorage but the backend rejected the session token.

## Change

- Added `window.HAPPYTgResetSession` to Mini App pages.
- For `401` auth bridge recovery, the server now sets `authResetSession: true`.
- The client clears localStorage and the Mini App session cookie before reading `savedSession`.
- The server also emits expired `Set-Cookie` headers for the Mini App session cookie.
- Regression tests assert the reset flag, script ordering, and cookie expiry for modern and legacy session routes.

## Validation

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm --filter @happytg/miniapp test` | `raw/test-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp typecheck` | `raw/typecheck-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp lint` | `raw/lint-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp build` | `raw/build-miniapp.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| Live public stale-cookie pre-fix probe | `raw/live-public-stale-cookie-before.json` | CONFIRMED |
| Live local stale-cookie post-fix probe | `raw/live-local-stale-cookie-after.json` | PASS |
| Live public stale-cookie post-fix probe | `raw/live-public-stale-cookie-after.json` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml ps api miniapp` | `raw/docker-ps.txt` | PASS |
| `graphify query "Mini App session page loading flicker jank session detail" --budget 1200` | `raw/graphify-query-session-jank.txt` | PASS |

## Fresh Verifier

- Verdict: PASS.
- Blocking findings: none.

## Residual Risk

This fixes stale Mini App session reload loops. If Telegram WebView fails to provide fresh `initData`, the auth bridge will wait and then show retry instead of reloading repeatedly.

## Browser Tooling Note

`npx playwright --version` resolved Playwright CLI `1.60.0`, but `npm exec --package=playwright@1.60.0 -- node -e "require.resolve('playwright')"` did not expose the module to `require()` on this Windows shell. Live HTTP smoke and Mini App regression tests were used as verification evidence.
