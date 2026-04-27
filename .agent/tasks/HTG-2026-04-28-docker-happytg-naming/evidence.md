# Evidence

## Changes

- `infra/docker-compose.example.yml` declares top-level Compose project `name: happytg`.
- `.env.example` includes `COMPOSE_PROJECT_NAME=happytg` for clean local envs.
- `packages/bootstrap/src/install/launch.ts` forces `COMPOSE_PROJECT_NAME=happytg` in the Docker launch environment while preserving existing `--env-file .env` port remapping.
- `packages/bootstrap/src/index.ts` recognizes running HappyTG Compose containers by the stable `happytg` project name instead of the old directory-derived `infra` project fallback.
- `README.md`, `docs/installation.md`, and `docs/self-hosting.md` now document the expected `happytg-<service>-1` container format.

## Naming Evidence

- `docker compose --env-file .env -f infra/docker-compose.example.yml config`
  - Raw: `raw/docker-compose-config.txt`
  - Result: passed.
  - Observed project: `name: happytg`.
  - Observed generated resource names: `happytg_default`, `happytg_caddy_config`, `happytg_caddy_data`, `happytg_grafana_data`, `happytg_prometheus_data`.
  - Secret-like config values were redacted in the raw proof artifact.
- `docker compose --dry-run --env-file .env -f infra/docker-compose.example.yml up --build -d`
  - Raw: `raw/docker-compose-dry-run-up.txt`
  - Result: passed.
  - Observed planned containers: `happytg-postgres-1`, `happytg-redis-1`, `happytg-minio-1`, `happytg-api-1`, `happytg-worker-1`, `happytg-prometheus-1`, `happytg-bot-1`, `happytg-miniapp-1`, `happytg-grafana-1`, `happytg-caddy-1`.
  - This used Compose dry-run to avoid starting or replacing local containers while still validating the existing launch command's generated names.

## Verification

- `pnpm --filter @happytg/bootstrap typecheck`
  - Raw: `raw/bootstrap-typecheck.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap test`
  - Raw: `raw/bootstrap-test.txt`
  - Result: passed, 123 tests.
- `pnpm happytg verify`
  - Raw: `raw/happytg-verify.txt`
  - Result: command exited 0 with environment warnings for local Codex transport, public Caddy Mini App identity, and occupied local ports 80/443/3000.
- `git diff --check`
  - Raw: `raw/git-diff-check.txt`
  - Result: no whitespace errors reported; Git printed existing line-ending normalization warnings.
