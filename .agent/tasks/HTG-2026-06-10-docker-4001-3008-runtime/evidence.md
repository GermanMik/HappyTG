# Evidence

Status: complete with one unrelated warning.

## Changes

- Updated `infra/docker-compose.example.yml` with `restart: unless-stopped` for Compose services.
- Updated local `.env` to publish API on `4001` and Mini App on `3008`.
- Updated local `.env` `HAPPYTG_APP_URL` to `http://localhost:3008`.
- Updated local `.env` `HAPPYTG_MINIAPP_UPSTREAM` to `miniapp:3001` so Compose Caddy uses the Docker-network service.
- Updated `api` container environment with `HAPPYTG_API_PORT=4000`; this prevents `.env` host port `4001` from making the API listen on the wrong in-container port.
- Updated local `.env.copy.local` with the same `4001/3008` and Docker-network upstream values.
- Added `infra/docker-compose.codex-desktop.yml` as an optional override that mounts `HAPPYTG_HOST_CODEX_HOME` read-only into the API container at `/codex-home` and sets `CODEX_HOME=/codex-home`.
- Added `HAPPYTG_HOST_CODEX_HOME` documentation to `.env.example` and `docs/configuration.md`.

## Results

- Manual host-side `pnpm` listeners on `4001/3008` were stopped before Docker bind.
- Docker Compose started `postgres`, `redis`, `minio`, `api`, and `miniapp`.
- `happytg-api-1` is healthy and publishes `0.0.0.0:4001->4000/tcp`.
- `happytg-miniapp-1` is healthy and publishes `0.0.0.0:3008->3001/tcp`.
- Docker inspect reports `unless-stopped` restart policy for both API and Mini App containers.
- API container with `infra/docker-compose.codex-desktop.yml` reports `/codex-home/.codex-global-state.json` present.
- Docker API `/api/v1/codex-desktop/projects` returned 12 projects after the read-only Codex home mount.
- Public `/miniapp/projects` rendered `Desktop projects` count `12` and the `C:\Develop\Projects\HappyTG` Desktop project.
- Docker API `/api/v1/codex-desktop/control` remains intentionally unsupported for mutating actions: `canCreateTask`, `canResume`, and `canStop` are false.
- Local `http://127.0.0.1:4001/ready` returned `{ "ok": true, "service": "api" }`.
- Local `http://127.0.0.1:3008/ready` returned `{ "ok": true, "service": "miniapp", "apiBaseUrl": "http://api:4000" }`.
- Public `https://happytg.gerta.crazedns.ru/miniapp/ready` returned HTTP 200 and the Docker Mini App readiness payload with `apiBaseUrl: "http://api:4000"`.
- Public `https://happytg.gerta.crazedns.ru/miniapp` returned HappyTG Mini App HTML with `happytg:miniapp:draft:v1`.
- Browser smoke opened `https://happytg.gerta.crazedns.ru/miniapp` as `HappyTG Mini App` with no console errors or warnings.
- `pnpm happytg verify` exited 0. It reported one unrelated Codex CLI memory warning and saw Docker-published Mini App `3008`, API `4001`, Redis `6380`, Postgres `5433`, and MinIO `9002/9006` as reused services.
- `docker compose --env-file .env -f infra/docker-compose.example.yml config --quiet` exited 0.
- `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml config --quiet` exited 0.
- `git diff --check -- infra/docker-compose.example.yml` exited 0 with only the existing CRLF/LF normalization warning.

## Raw Outputs

- `raw/docker-compose-config-after-port-update.txt`
- `raw/docker-compose-config-final.txt`
- `raw/docker-compose-config-with-codex-desktop-final.txt`
- `raw/docker-compose-up.txt`
- `raw/docker-compose-up-after-api-port-fix.txt`
- `raw/docker-compose-ps-after-up.txt`
- `raw/docker-compose-ps-after-api-port-fix.txt`
- `raw/curl-local-api-4001-ready.*`
- `raw/curl-local-miniapp-3008-ready.*`
- `raw/curl-public-443-ready.*`
- `raw/happytg-verify-after-docker.txt`
- `raw/docker-inspect-restart-health.txt`
- `raw/docker-inspect-restart-health-final.txt`
- `raw/browser-snapshot-443-after-docker.yml`
- `raw/browser-console-443-after-docker.log`
- `raw/docker-api-codex-home-mount.txt`
- `raw/curl-docker-codex-desktop-projects-after-mount.body.json`
- `raw/curl-docker-codex-desktop-control-after-mount.body.json`
- `raw/curl-public-projects-after-mount.html`
- `raw/happytg-verify-after-codex-mount.txt`
- `raw/git-diff-check-final.txt`
