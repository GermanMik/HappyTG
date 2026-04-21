# Self-Hosting

## Deployment Modes

- Single-user mode: one operator, one control plane, one or more hosts.
- Small-team mode: shared control plane, multiple users, multiple hosts, stricter policy layers.

## Recommended Shape

- PostgreSQL for durable state and projections.
- Redis or NATS JetStream for queueing and pub/sub.
- S3-compatible object storage for artifacts that do not belong in Git.
- Reverse proxy with TLS in front of API and Mini App.
- Prometheus and Grafana for MVP observability.
- `infra/Dockerfile.app` for packaged API, worker, bot, and Mini App surfaces.
- `apps/host-daemon` running directly on each execution host, outside the control-plane container stack.

## Public Topology

For `happytg.gerta.crazedns.ru`, use one HTTPS origin and path-based routing:

- `/miniapp` -> Mini App frontend
- `/api/*` -> control-plane API
- `/health` -> fast API health
- `/bot/webhook` -> Telegram webhook, rewritten to the bot app's internal `/telegram/webhook`
- `/static/*` -> Mini App static assets

The starter Caddy config is `infra/caddy/Caddyfile`.

## Control Plane Bring-Up

1. Copy `.env.example` to `.env` on the control-plane host.
2. Fill production values for database, Redis, object storage, Telegram webhook, and signing keys.
3. Start the packaged services:

   ```bash
   docker compose -f infra/docker-compose.example.yml up --build -d
   ```

4. Confirm API, bot, worker, and Mini App logs are healthy.
5. Confirm Prometheus can scrape API `/metrics` and Grafana can see the Prometheus datasource.
6. Configure Telegram webhook delivery against the public API endpoint.

## Execution Host Bring-Up

1. Install Git, Node.js 22+, `pnpm`, and Codex CLI on the execution host.
2. Run `pnpm happytg doctor` and resolve blocking findings.
3. Start `apps/host-daemon` directly on the execution host.
4. Pair the host through Telegram and wait for the control plane to record the host heartbeat.
5. Run `pnpm happytg verify` and one quick Codex smoke session before allowing proof-loop tasks.

## Telegram Delivery

- Prefer webhook in stable deployments.
- Allow polling for local development or degraded setups.
- `TELEGRAM_UPDATES_MODE=auto` chooses polling for local/non-public `HAPPYTG_PUBLIC_URL` values and webhook for public HTTPS URLs.
- `TELEGRAM_UPDATES_MODE=webhook` keeps the deployment webhook-first and surfaces a degraded bot ready state when Telegram is not actually pointed at the expected webhook URL.
- `TELEGRAM_UPDATES_MODE=polling` is acceptable for local bring-up or temporary degraded operation, but it should not replace webhook-first stable deployments.

## Backup and Upgrade

- Backup PostgreSQL, object storage metadata, and `.happytg/` host state.
- Backup `.happytg-dev/control-plane.json` while the MVP file store is in use.
- Backup repo-local `.agent/tasks/<task-id>/` proof bundles for completed and in-flight proof tasks.
- Run migrations before app restart when required.
- Preserve event log and approval records across upgrades.
- Keep `.env`, reverse proxy config, and `~/.codex/config.toml` under your normal secrets/config backup process.
- Follow the detailed runbook in `docs/operations/runbook.md`.

## Observability

- API exposes `/metrics` for internal Prometheus scraping.
- `/health`, `/ready`, and `/version` remain fast-path checks.
- The starter compose file includes Prometheus and Grafana. Keep those ports private or behind your own access control.
- See `docs/operations/observability.md`.

## Rollback

- Freeze new task intake.
- Stop compose services.
- Restore the previous image/check-out and backed-up state if needed.
- Start API first, then bot, Mini App, worker, and Caddy.
- Confirm pending approvals and resumable sessions before allowing new mutations.

## Host Reconnect

Hosts must reconnect using refresh tokens and resume outstanding sessions without replaying completed mutations.

## Operational Guardrails

- Do not run mutating task execution on the control-plane host unless it is also the intended execution machine.
- Treat Telegram as a render surface only; the source of truth remains the API state store, event log, and repo-local proof artifacts.
- Keep the local CI baseline green with `pnpm typecheck`, `pnpm test`, and `pnpm build` before rolling out new images.
