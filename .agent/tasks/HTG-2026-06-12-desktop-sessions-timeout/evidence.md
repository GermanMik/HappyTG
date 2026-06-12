# Evidence

Task: `HTG-2026-06-12-desktop-sessions-timeout`

## Finding

Mini App Desktop session list used `HAPPYTG_MINIAPP_CODEX_FETCH_TIMEOUT_MS` default `2500`. Live Docker API returned `/api/v1/codex-desktop/sessions?limit=50` in about 3.5s, so the Mini App aborted the request and showed `Desktop sessions unavailable: This operation was aborted`.

## Change

- Raised the default Mini App Codex fallback timeout to `6000ms`.
- Normalized `AbortError` / aborted fetch messages to `request timed out after <N>ms`.
- Added a regression test that verifies the raw `This operation was aborted` text does not render into the Codex panel.

## Validation

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm --filter @happytg/miniapp test` | `raw/test-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp typecheck` | `raw/typecheck-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp lint` | `raw/lint-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp build` | `raw/build-miniapp.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| `pnpm happytg task validate --repo . --task HTG-2026-06-12-desktop-sessions-timeout` | `raw/task-validate.txt` | PASS |
| `pnpm release:check --version 0.4.23` | `raw/release-check-0.4.23.txt` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml up -d --build miniapp` | live rebuild | PASS |
| Local `/codex?source=codex-desktop` smoke | `raw/live-local-codex-desktop-smoke.json` | PASS |
| Public `/miniapp/codex?source=codex-desktop` smoke | `raw/live-public-codex-desktop-smoke.json` | PASS |
| `graphify query "Mini App Desktop sessions unavailable operation aborted timeout" --budget 1200` | `raw/graphify-query-desktop-sessions-timeout.txt` | PASS |

## Runtime Evidence

- Live API `/api/v1/codex-desktop/sessions?limit=50` returned 50 sessions in about 3.7s, above the old timeout and below the new default.
- After rebuilding Docker from this branch, local and public Mini App Codex Desktop pages returned HTTP 200 in about 4.8s, rendered Desktop session links, and did not contain `Desktop sessions unavailable`, `This operation was aborted`, or `request timed out after`.
- Release metadata for `0.4.23` passed validation.

## Fresh Verifier

- Verdict: PASS.
- Blocking findings: none.
