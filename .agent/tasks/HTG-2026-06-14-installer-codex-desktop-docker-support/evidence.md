# Evidence

## Change

- `DockerServiceStrategyPlan` now carries a `desktop` sub-plan with projection/control status, applied override files, safe detail text, and warnings.
- Docker launch planning detects a readable host Codex home from `repoEnv.HAPPYTG_HOST_CODEX_HOME`, `installEnv.HAPPYTG_HOST_CODEX_HOME`, or the real installer `~/.codex` fallback.
- When a Codex home is readable, Docker compose commands include `infra/docker-compose.codex-desktop.yml` and receive `HAPPYTG_HOST_CODEX_HOME`, so the API container can mount Desktop state and list Desktop projects/sessions.
- Host-proxy control remains explicit opt-in. `infra/docker-compose.codex-desktop-host-proxy.yml` is included only when `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy` or `HAPPYTG_CODEX_DESKTOP_PROXY_URL` is configured.
- Docker finalization and next steps now render the same compose override files used by actual `config`, `up`, `ps`, `logs`, and `down` commands.

## Tests Added

- Unit coverage for readable Codex home detection and mount override selection.
- Unit coverage for missing Codex home leaving Docker Desktop projection disabled.
- Unit coverage for host-proxy override only on explicit operator env.
- Installer orchestration coverage proving non-interactive Docker launch passes `-f infra/docker-compose.codex-desktop.yml` and `HAPPYTG_HOST_CODEX_HOME` when repo `.env` configures a readable host Codex home.

## Validation

- `pnpm --filter @happytg/bootstrap test` passed; see `raw/bootstrap-test.txt`.
- `pnpm --filter @happytg/bootstrap typecheck` passed; see `raw/bootstrap-typecheck.txt`.
- `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml -f infra/docker-compose.codex-desktop-host-proxy.yml config --quiet` passed; see `raw/docker-compose-config.txt`.
- Targeted `git diff --check` passed; see `raw/diff-check.txt`.

## Builder Finding

- An intermediate test revision mutated `process.env` inside concurrent top-level tests. That caused unrelated setup/doctor assertions to fail. The fix was to remove global env mutation and feed the integration path through a temp repo `.env` instead.

## Residual Risk

- Installer does not install or elevate the Windows Scheduled Task for `pnpm daemon:desktop-proxy`; host-proxy durability remains operator-managed.
- If an operator has `HAPPYTG_HOST_CODEX_HOME` set to an unreadable path, the installer records a warning and only enables the Desktop projection when another readable candidate is found.
