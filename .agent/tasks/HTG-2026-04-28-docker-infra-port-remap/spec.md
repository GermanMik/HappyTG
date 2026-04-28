# HTG-2026-04-28-docker-infra-port-remap

Phase: complete

## Scope

Fix the installer Docker launch path where `--launch-mode docker` still runs `docker compose up --build -d` with default shared-infra host port bindings even after port preflight reports local PostgreSQL, Redis, or MinIO as supported reuse. This causes Compose to fail with errors like `Bind for 0.0.0.0:5432 failed: port is already allocated`.

## Acceptance Criteria

- In Docker launch mode, occupied shared-infra host ports (`HAPPYTG_REDIS_HOST_PORT`, `HAPPYTG_POSTGRES_HOST_PORT`, `HAPPYTG_MINIO_PORT`, `HAPPYTG_MINIO_CONSOLE_PORT`) must be remapped to suggested free ports before Compose starts.
- The remap must be saved to `.env` and passed to Docker Compose through the repo environment so `--env-file .env` and command environment agree.
- App port conflict handling must remain unchanged.
- A regression test must cover supported local infra on default ports and prove Docker launch receives remapped env values before `compose up`.

## Out Of Scope

- Removing shared infra services from `infra/docker-compose.example.yml`.
- Making host-run services the default backend for app containers.
- Changing the host daemon rule; it remains outside Compose.
