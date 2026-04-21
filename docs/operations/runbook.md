# HappyTG Self-Hosted Runbook

## Preflight

1. Copy `.env.example` to `.env`.
2. Set Telegram, signing, Mini App launch, database, Redis, S3, and Grafana secrets.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
4. Run `pnpm happytg doctor` and `pnpm happytg verify`.
5. Confirm host daemon can pair and heartbeat.

## Start

```bash
docker compose -f infra/docker-compose.example.yml up --build -d
```

Then verify:

```bash
curl -fsS http://localhost:${HAPPYTG_API_PORT:-4000}/health
curl -fsS http://localhost:${HAPPYTG_API_PORT:-4000}/ready
curl -fsS http://localhost:${HAPPYTG_API_PORT:-4000}/version
curl -fsS http://localhost:${HAPPYTG_API_PORT:-4000}/metrics
```

## Backup

Back up before upgrades and after important sessions:

- PostgreSQL database dump.
- object storage bucket metadata and retained artifacts.
- `.happytg-dev/control-plane.json` for current MVP file-store deployments.
- execution-host `~/.happytg/` daemon state.
- `.env` and reverse proxy configuration through your secret/config backup process.
- repo-local `.agent/tasks/<task-id>/` proof bundles.

## Upgrade

1. Freeze new task intake.
2. Let active mutating dispatches finish or pause sessions.
3. Back up state and proof bundles.
4. Pull the release.
5. Run `pnpm install --frozen-lockfile`.
6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
7. Rebuild compose images.
8. Start services and verify health/ready/version/metrics.
9. Resume paused sessions only after host heartbeat is fresh.

## Rollback

1. Stop compose services.
2. Restore previous image or checkout.
3. Restore backed-up state if the failed upgrade wrote incompatible state.
4. Start API first, then bot, Mini App, worker, and Caddy.
5. Verify pending approvals and sessions before allowing new mutations.

## Degraded Mode

- Telegram unavailable: bot `/ready` should be degraded, not silently healthy. Mini App/API remain usable for inspection.
- Host disconnected: worker should move active sessions to resumable state; do not replay completed mutations.
- Mini App auth failure: re-open from bot to get fresh Telegram `initData` and launch payload.
