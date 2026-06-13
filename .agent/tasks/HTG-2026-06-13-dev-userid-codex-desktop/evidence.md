# Evidence

## Implementation

- Added a non-production read-only Codex Desktop projection user hint for `usr_1`.
- Kept Codex Desktop mutating actions on strict `assertKnownUser` authorization.
- Added service coverage for:
  - `usr_1` read-only projection success outside production;
  - `usr_1` rejection in production;
  - `usr_1` mutation rejection without a real active user.

## Validation

- `pnpm --filter @happytg/api test` PASS: 25 tests.
- `pnpm --filter @happytg/api typecheck` PASS.
- `pnpm --filter @happytg/api lint` PASS.
- `git diff --check` PASS.
- Docker API was rebuilt with `infra/docker-compose.example.yml` and `infra/docker-compose.codex-desktop.yml`.
- Live smoke after rebuild:
  - `/api/v1/codex-desktop/projects?userId=usr_1`: `200`, 12 projects, no `CODEX_DESKTOP_USER_NOT_FOUND`.
  - `/api/v1/codex-desktop/sessions?limit=100&userId=usr_1`: `200`, 100 sessions, no `CODEX_DESKTOP_USER_NOT_FOUND`.
  - `/projects/tasks?...&userId=usr_1`: `200`, no Desktop unavailable warning.
  - In-app browser opened local `/projects/tasks` with title `Прошедшие задачи`; console had 0 warnings/errors.

Raw logs are under `raw/`.
