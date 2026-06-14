# Evidence

## Diagnosis

- The live API container had no mounts and returned `{"projects":[]}` for `/api/v1/codex-desktop/projects?userId=usr_1`.
- Recreating API/Mini App with `infra/docker-compose.codex-desktop.yml` restored the read-only `/codex-home` mount and Desktop projects.
- The selected HappyTG project route still rendered `0 visible` because recent `session_index.jsonl` records had ids/titles but no project path.
- Session JSONL files contain `cwd`, but `collectJsonlFiles()` traversed dated `sessions/YYYY/MM/DD` directories oldest-first and stopped at the configured limit before reaching recent files.

## Change

- `packages/runtime-adapters/src/codex-desktop.ts` now visits session JSONL entries newest-first by descending name, which matches the dated Codex Desktop layout.
- Added a regression test proving `maxSessionFiles: 1` reads the newest dated session file and assigns `projectPath` to the recent session.
- Rebuilt and restarted Docker API/Mini App with:
  - `infra/docker-compose.example.yml`
  - `infra/docker-compose.codex-desktop.yml`

## Validation

- `pnpm --filter @happytg/runtime-adapters test` passed; see `raw/runtime-adapters-test.txt`.
- `pnpm --filter @happytg/runtime-adapters typecheck` passed; see `raw/runtime-adapters-typecheck.txt`.
- `pnpm --filter @happytg/api typecheck` passed; see `raw/api-typecheck.txt`.
- `pnpm --filter @happytg/miniapp test` passed; see `raw/miniapp-test.txt`.
- Targeted `git diff --check` passed; see `raw/diff-check.txt`.
- `pnpm happytg task validate --repo . --task HTG-2026-06-14-desktop-session-projectpath-runtime --json` passed with `canonicalOk: true`; see `raw/task-validate.txt`.
- Docker rebuild/recreate passed; see `raw/docker-rebuild.txt`.
- Docker API/Mini App are healthy; see `raw/docker-ps.txt`.
- Live smoke confirmed:
  - API sessions now include `projectPath` for HappyTG sessions.
  - Local selected project route shows `5 visible`.
  - Public `/miniapp` selected project route shows `5 visible`.
  - The `Починить очередь сессий` session is visible.

## Residual Risk

- Codex Desktop mutating controls remain unsupported in this Docker mode until the host proxy is enabled.
