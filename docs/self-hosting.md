# Self-Hosting

## Deployment Modes

- Single-user mode: one operator, one control plane, one or more hosts.
- Small-team mode: shared control plane, multiple users, multiple hosts, stricter policy layers.

## Recommended Shape

- PostgreSQL for durable state and projections.
- Redis or NATS JetStream for queueing and pub/sub.
- S3-compatible object storage for artifacts that do not belong in Git.
- Reverse proxy with TLS in front of API and Mini App.
- `infra/Dockerfile.app` for packaged API, worker, bot, and Mini App surfaces.
- `apps/host-daemon` running directly on each execution host, outside the control-plane container stack.

## Control Plane Bring-Up

1. Copy `.env.example` to `.env` on the control-plane host.
2. Fill production values for database, Redis, object storage, Telegram webhook, and signing keys.
3. Start the packaged services:

   ```bash
   docker compose -f infra/docker-compose.example.yml up --build -d
   ```

4. Confirm API, bot, worker, and Mini App logs are healthy.
5. Configure Telegram webhook delivery against the public API endpoint.

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
- Run migrations before app restart when required.
- Preserve event log and approval records across upgrades.
- Keep `.env`, reverse proxy config, and `~/.codex/config.toml` under your normal secrets/config backup process.

## Host Reconnect

Hosts must reconnect using refresh tokens and resume outstanding sessions without replaying completed mutations.

## Operational Guardrails

- Do not run mutating task execution on the control-plane host unless it is also the intended execution machine.
- Treat Telegram as a render surface only; the source of truth remains the API state store, event log, and repo-local proof artifacts.
- Keep the local CI baseline green with `pnpm typecheck`, `pnpm test`, and `pnpm build` before rolling out new images.
