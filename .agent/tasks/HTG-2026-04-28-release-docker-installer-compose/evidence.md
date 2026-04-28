# Evidence

## Scope Released

The release bundle covers the accumulated Docker/installer changes on `codex/installer-docker-caddy-port80-repair`:

- Docker launch port preflight/remapping for Caddy HTTP/HTTPS plus Prometheus/Grafana.
- Existing `.env` confirmation screen and masked Telegram value handling.
- Windows `pnpm.ps1` / native command error handling in install scripts.
- Stable Docker Compose project/container naming with project `happytg`.

The unrelated untracked `.agent/tasks/HTG-2026-04-28-codex-desktop-telegram-control/` artifact was left out of release scope.

## Checks

- `pnpm lint`
  - Raw: `raw/lint.txt`
  - Result: passed, 15/15 packages.
- `pnpm typecheck`
  - Raw: `raw/typecheck.txt`
  - Result: passed, 15/15 packages.
- `pnpm test`
  - Raw: `raw/test.txt`, copied to canonical `raw/test-unit.txt` and `raw/test-integration.txt`.
  - Result: passed, 15/15 packages.
- `pnpm build`
  - Raw: `raw/build.txt`
  - Result: passed, 15/15 packages.
- `docker compose --env-file .env -f infra/docker-compose.example.yml config`
  - Raw: `raw/docker-compose-config.txt`
  - Result: passed. Secret-like environment values were redacted in the raw artifact.
  - Observed project/resource names: `name: happytg`, `happytg_default`, `happytg_caddy_config`, `happytg_caddy_data`, `happytg_grafana_data`, `happytg_prometheus_data`.
- `docker compose --dry-run --env-file .env -f infra/docker-compose.example.yml up --build -d`
  - Raw: `raw/docker-compose-dry-run-up.txt`
  - Result: passed.
  - Observed planned containers: `happytg-postgres-1`, `happytg-redis-1`, `happytg-minio-1`, `happytg-api-1`, `happytg-bot-1`, `happytg-prometheus-1`, `happytg-miniapp-1`, `happytg-worker-1`, `happytg-caddy-1`, `happytg-grafana-1`.
- `pnpm happytg doctor`
  - Raw: `raw/happytg-doctor.txt`
  - Result: exited 0 with environment warnings.
- `pnpm happytg verify`
  - Raw: `raw/happytg-verify.txt`
  - Result: exited 0 with environment warnings.
- Included task proof validation
  - Raw: `raw/task-validate-included-final.txt`
  - Result: all included task bundles validate.
- `git diff --check`
  - Raw: `raw/git-diff-check.txt`
  - Result: passed.
- `pnpm release:check -- --version 0.4.6`
  - Raw: `raw/release-check-versioned.txt`
  - Result: passed.
- `pnpm happytg task validate --repo . --task HTG-2026-04-28-release-docker-installer-compose`
  - Raw: `raw/task-validate.txt`
  - Result: passed.

## Post-Rebase Checks

- Branch rebased onto `origin/main` (`5cf11a7`, PR #37).
- `pnpm install --frozen-lockfile`
  - Raw: `raw/post-rebase-install.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap typecheck`
  - Raw: `raw/post-rebase-bootstrap-typecheck.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap test`
  - Raw: `raw/post-rebase-bootstrap-test.txt`
  - Result: passed.
- `docker compose --env-file .env -f infra/docker-compose.example.yml config`
  - Raw: `raw/post-rebase-docker-compose-config.txt`
  - Result: passed using a local untracked `.env` copied from `.env.example` in the clean release worktree.
  - Observed project/resource names: `name: happytg`, `happytg_default`, `happytg_caddy_config`, `happytg_caddy_data`, `happytg_grafana_data`, `happytg_prometheus_data`.
- `docker compose --dry-run --env-file .env -f infra/docker-compose.example.yml up --build -d`
  - Raw: `raw/post-rebase-docker-compose-dry-run-up.txt`
  - Result: passed.
  - Observed planned containers: `happytg-postgres-1`, `happytg-minio-1`, `happytg-redis-1`, `happytg-api-1`, `happytg-prometheus-1`, `happytg-bot-1`, `happytg-miniapp-1`, `happytg-worker-1`, `happytg-caddy-1`, `happytg-grafana-1`.
- `pnpm happytg doctor`
  - Raw: `raw/post-rebase-happytg-doctor.txt`
  - Result: exited 0 with environment warnings.
- `pnpm happytg verify`
  - Raw: `raw/post-rebase-happytg-verify.txt`
  - Result: exited 0 with environment warnings.
- `pnpm release:check -- --version 0.4.6`
  - Raw: `raw/post-rebase-release-check-versioned.txt`
  - Result: passed.
- `pnpm happytg task validate --repo . --task HTG-2026-04-28-release-docker-installer-compose`
  - Raw: `raw/post-rebase-task-validate.txt`
  - Result: passed.

## Branch State

- `git fetch origin` completed.
- Release branch `codex/release-docker-installer-compose-20260428` is rebased onto `origin/main`.
- The original worktree received unrelated concurrent edits during release; those were preserved in git stash entries and excluded from the release commit.
