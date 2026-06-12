# Evidence

Task: `HTG-2026-06-12-desktop-session-readonly-warning`

## Finding

Opening historical Codex Desktop sessions was visually treated like an error because Mini App rendered the unsupported Desktop mutation contract as a page-level warning:

- `/codex` rendered `Desktop actions may be disabled: [CODEX_DESKTOP_CONTROL_UNSUPPORTED] ...` whenever any Desktop session had disabled actions.
- `/codex/desktop-session` rendered a separate warning section with the same unsupported reason before the read-only history.

This was misleading for past-session browsing: read-only Desktop session history can be valid even when Resume/Stop/New Task are disabled.

## Change

- Removed the page-level unsupported-actions warning from the Codex panel.
- Removed the standalone unsupported-actions warning from Desktop session detail.
- Kept disabled action buttons/forms and their `title` reason, so unsupported mutations remain explicit where the operator tries to act.
- Kept API/runtime-adapter unsupported semantics unchanged.

## Files

- `apps/miniapp/src/index.ts`
- `apps/miniapp/src/index.test.ts`
- `.agent/tasks/HTG-2026-06-12-desktop-session-readonly-warning/`

## Validation

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm --filter @happytg/miniapp test` | `raw/test-miniapp.txt` | FAIL before test expectation update |
| `pnpm --filter @happytg/miniapp test` rerun | `raw/test-miniapp-final.txt` | PASS |
| `pnpm --filter @happytg/miniapp typecheck` | `raw/typecheck-miniapp-final.txt` | PASS |
| `pnpm --filter @happytg/miniapp lint` | `raw/lint-miniapp-final.txt` | PASS |
| `pnpm --filter @happytg/miniapp build` | `raw/build-miniapp-final.txt` | PASS |
| `git diff --check` | `raw/diff-check-release-final.txt` | PASS |
| `pnpm happytg task validate --repo . --task HTG-2026-06-12-desktop-session-readonly-warning` | `raw/task-validate-release-final.txt` | PASS |
| `pnpm release:check --version 0.4.21` | `raw/release-check-0.4.21.txt` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml up -d --build miniapp` | `raw/docker-miniapp-rebuild.txt` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml up -d --build api miniapp` | `raw/docker-codex-desktop-override-rebuild.txt` | PASS |
| `docker exec happytg-api-1 ... CODEX_HOME/session_index smoke` | `raw/live-desktop-codex-home-mount.txt` | PASS |
| `GET /api/v1/codex-desktop/projects` with the local active user | `raw/live-desktop-projects-api-real-user.json` | PASS |
| `GET http://127.0.0.1:3008/projects?source=codex-desktop` with the local active user | `raw/live-desktop-projects-miniapp-local.json` | PASS |
| `GET https://happytg.gerta.crazedns.ru/miniapp/projects?source=codex-desktop` with the local active user | `raw/live-desktop-projects-miniapp-public.json` | PASS |
| `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml ps api miniapp` | `raw/docker-codex-desktop-ps.txt` | PASS |
| `graphify update apps/miniapp/src` | `raw/graphify-update-miniapp-src.txt` | PASS; generated scoped `apps/miniapp/src/graphify-out/` was removed as noncanonical release output |
| `graphify query "Mini App Codex Desktop unsupported warning and Desktop projects empty state" --budget 1200` | `raw/graphify-query-miniapp-warning-projects.txt` | PASS |

## Runtime Smoke

- Rebuilt and restarted the Docker `happytg-miniapp-1` service from the current branch.
- Compose also recreated `happytg-api-1` as part of the service graph.
- `http://127.0.0.1:3008/codex?source=codex-desktop&userId=usr_1` returned HTTP 200 and did not contain `Desktop actions may be disabled`.
- `https://happytg.gerta.crazedns.ru/miniapp/codex?source=codex-desktop&userId=usr_1` returned HTTP 200 and did not contain `Desktop actions may be disabled`.
- After the user reported `Desktop projects не найдены` / `Codex Desktop adapter did not return local projects`, the Docker stack was rebuilt with `infra/docker-compose.codex-desktop.yml` so API has `CODEX_HOME=/codex-home`.
- `/codex-home/session_index.jsonl` and `/codex-home/.codex-global-state.json` are visible inside `happytg-api-1`.
- `GET /api/v1/codex-desktop/projects` for the local active user returned HTTP 200 with `projectsCount: 12`.
- Local Mini App `/projects?source=codex-desktop` returned HTTP 200, did not contain `Desktop projects не найдены`, did not contain `Codex Desktop adapter did not return local projects`, and rendered Desktop action links.
- Public Mini App `/miniapp/projects?source=codex-desktop` returned HTTP 200 with the same no-empty-state result.
- Graphify was used as scoped navigation/update evidence. The scoped `graphify update apps/miniapp/src` completed, but its generated nested `apps/miniapp/src/graphify-out/` output was removed to avoid committing noncanonical graph artifacts; the raw command output remains in this proof bundle.
- Release metadata was prepared for `0.4.21` after rebasing onto `origin/main`, which already carried `0.4.20`.

## Fresh Verifier

- Verdict: PASS.
- Blocking findings: none.
- Critical review by 10 independent roles is captured in `raw/critical-review-10-roles.md`.
- Read-only Desktop session entry no longer displays unsupported Desktop mutation state as a page-level error.
- Disabled Desktop action controls still expose unsupported reason codes in their disabled context.
- Post-rebase Mini App scoped validation and `pnpm release:check --version 0.4.21` passed.
