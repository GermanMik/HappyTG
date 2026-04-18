# Configuration

## Configuration Surfaces

- `.env`: deployment and application variables.
- `~/.codex/config.toml`: Codex CLI local runtime settings.
- `~/.happytg/`: local bootstrap reports, daemon state, and backups.
- repo-local `.agent/tasks/`: proof artifacts.

## Important Variables

- `DATABASE_URL`
- `REDIS_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_UPDATES_MODE`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_ALLOWED_USER_IDS`
- `TELEGRAM_HOME_CHANNEL`
- `JWT_SIGNING_KEY`
- `CODEX_CLI_BIN`
- `CODEX_CONFIG_PATH`
- `HOST_DAEMON_MUTATION_QUEUE_CONCURRENCY`
- `HAPPYTG_MINIAPP_PORT`
- `HAPPYTG_API_PORT`
- `HAPPYTG_BOT_PORT`
- `HAPPYTG_WORKER_PORT`
- `HAPPYTG_REDIS_HOST_PORT`

## Telegram Update Delivery

- `TELEGRAM_UPDATES_MODE=auto` selects polling when `HAPPYTG_PUBLIC_URL` looks local and webhook mode when it looks public.
- Set `TELEGRAM_UPDATES_MODE=polling` to force `getUpdates` in development or degraded setups.
- Set `TELEGRAM_UPDATES_MODE=webhook` when Telegram is already delivering updates to your public `/telegram/webhook` endpoint.

## Policy Configuration

Policies are layered:

1. global
2. deployment
3. workspace
4. session
5. command

Lower layers may tighten but must not weaken higher layers.
