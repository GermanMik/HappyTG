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
- `/api/v1/miniapp/auth/session` -> public Mini App session creation, validated with Telegram `initData`
- `/api/v1/miniapp/approvals/{id}/resolve` -> public Mini App approval action endpoint, protected by Mini App bearer session auth
- `/api/*` -> not publicly proxied by the starter Caddy config; keep control-plane and daemon mutations internal
- `/health` -> fast API health
- `/telegram/webhook` -> public Telegram webhook delivery endpoint
- `/static/*` -> Mini App static assets
- `/` -> redirect to `/miniapp`

The starter Caddy config is `infra/caddy/Caddyfile`.

If upstream public `443` maps to Caddy:

```env
HAPPYTG_DOMAIN=happytg.gerta.crazedns.ru
HAPPYTG_PUBLIC_URL=https://happytg.gerta.crazedns.ru
HAPPYTG_MINIAPP_URL=https://happytg.gerta.crazedns.ru/miniapp
HAPPYTG_APP_URL=https://happytg.gerta.crazedns.ru/miniapp
```

If public HTTPS TCP `8443` maps to Caddy, keep the port in every public URL:

```env
HAPPYTG_DOMAIN=happytg.gerta.crazedns.ru
HAPPYTG_HTTPS_PORT=8443
HAPPYTG_PUBLIC_URL=https://happytg.gerta.crazedns.ru:8443
HAPPYTG_MINIAPP_URL=https://happytg.gerta.crazedns.ru:8443/miniapp
HAPPYTG_APP_URL=https://happytg.gerta.crazedns.ru:8443/miniapp
```

The Compose file maps `${HAPPYTG_HTTPS_PORT:-443}:443`; this supports external `8443` without assuming public `443`. If only non-standard HTTPS is externally reachable, automatic Caddy ACME issuance may require DNS challenge, an external certificate, or an upstream TLS proxy. Verify TLS with the exact public URL before configuring Telegram.

## Mini App Port Model

There are two Mini App ports to keep separate:

- local/host port: `HAPPYTG_MINIAPP_PORT`, for example `3007` when `3001` is occupied on the host;
- Docker internal port: `3001`, used by the `miniapp` service and Docker-network Caddy upstream `miniapp:3001`.

For Docker Compose, keep `HAPPYTG_MINIAPP_UPSTREAM` unset. The compose file maps `${HAPPYTG_MINIAPP_PORT:-3001}:3001` and forces the Mini App container listener to `3001`, so a host-side `3007` does not break Caddy.

For host-run Caddy with `pnpm dev:miniapp` on `3007`, set:

```env
HAPPYTG_MINIAPP_PORT=3007
HAPPYTG_APP_URL=http://localhost:3007
HAPPYTG_DEV_CORS_ORIGINS=http://localhost:3007,http://127.0.0.1:3007
HAPPYTG_MINIAPP_UPSTREAM=127.0.0.1:3007
```

## Control Plane Bring-Up

1. Copy `.env.example` to `.env` on the control-plane host.
2. Fill production values for database, Redis, object storage, Telegram webhook, Mini App URL, and signing keys.
3. Start the packaged services:

   ```bash
   docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d
   ```

   The installer can make this an explicit first-start choice with:

   ```bash
   pnpm happytg install --launch-mode docker
   ```

   This starts API, worker, bot, Mini App, Caddy, and observability through Compose, but it does not start `apps/host-daemon`.

4. Confirm API, bot, worker, and Mini App logs are healthy. The installer's Docker launch path validates:
   - `docker compose --env-file .env -f infra/docker-compose.example.yml config`
   - `docker compose --env-file .env -f infra/docker-compose.example.yml ps`
   - host readiness for `http://127.0.0.1:${HAPPYTG_API_PORT:-4000}/ready`, `http://127.0.0.1:${HAPPYTG_BOT_PORT:-4100}/ready`, and `http://127.0.0.1:${HAPPYTG_MINIAPP_PORT:-3001}/ready`
   - worker health through Compose service health
5. Confirm Prometheus can scrape API `/metrics` and Grafana can see the Prometheus datasource.
6. Configure Telegram webhook delivery against `https://<domain>/telegram/webhook`.
7. Configure the persistent Telegram menu button after the public route passes preflight:

   ```bash
   pnpm happytg telegram menu set --dry-run
   pnpm happytg telegram menu set
   ```

## Execution Host Bring-Up

1. Install Git, Node.js 22+, `pnpm`, and Codex CLI on the execution host.
2. Run `pnpm happytg doctor` and resolve blocking findings.
3. Start `apps/host-daemon` directly on the execution host. This remains outside Compose by design.
4. Pair the host through Telegram and wait for the control plane to record the host heartbeat.
5. Run `pnpm happytg verify` and one quick Codex smoke session before allowing proof-loop tasks.

## Telegram Delivery

- Prefer webhook in stable deployments.
- Allow polling for local development or degraded setups.
- `TELEGRAM_UPDATES_MODE=auto` chooses polling for local/non-public `HAPPYTG_PUBLIC_URL` values and webhook for public HTTPS URLs.
- `TELEGRAM_UPDATES_MODE=webhook` keeps the deployment webhook-first and surfaces a degraded bot ready state when Telegram is not actually pointed at the expected webhook URL.
- `TELEGRAM_UPDATES_MODE=polling` is acceptable for local bring-up or temporary degraded operation, but it should not replace webhook-first stable deployments.
- Webhook delivery and Mini App launch are separate URLs:
  - webhook delivery: `https://<domain>/telegram/webhook`
  - Mini App public URL: `https://<domain>/miniapp`
- Configure the persistent bot menu with `pnpm happytg telegram menu set` after the public `/miniapp` route passes preflight. BotFather Main Mini App/profile setup is still a separate manual Telegram setting when you need it.
- Do not use `http://localhost:3001` or any non-HTTPS/private URL for production Telegram `web_app` buttons.

## Telegram Mini App Menu

`/start` and `/menu` still render inline `web_app` buttons when the resolved Mini App URL is public HTTPS. The persistent menu button is different: it is stored by Telegram through Bot API `setChatMenuButton` and survives normal chat refreshes.

Run:

```bash
pnpm happytg telegram menu set --dry-run
pnpm happytg telegram menu set
```

The command chooses a usable public HTTPS Mini App URL from `HAPPYTG_MINIAPP_URL`, `HAPPYTG_APP_URL`, or `HAPPYTG_PUBLIC_URL + /miniapp`; validates that the URL is public HTTPS; checks the public Caddy `/miniapp` route; and only then calls Telegram. BotFather/Main Mini App profile setup is still a separate manual Telegram setting if you need the Mini App shown on the bot profile.

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
