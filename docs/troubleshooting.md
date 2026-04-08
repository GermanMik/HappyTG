# Troubleshooting

## Common Issues

### Host cannot pair

- verify `TELEGRAM_BOT_TOKEN` is set and not a placeholder,
- verify pairing code TTL,
- verify host clock skew,
- verify API reachability,
- verify refresh token persistence.

### Codex smoke check fails

- verify `codex` is in `PATH`,
- verify `~/.codex/config.toml` exists and is readable,
- verify network access required by Codex,
- rerun `pnpm happytg doctor` and `pnpm happytg verify` in the repository, or `happytg doctor` / `happytg verify` if the CLI is installed globally.

### Redis blocks first start

- run `pnpm happytg setup` and check the Redis line in the preflight summary,
- if Redis is already running on `6379`, reuse it and skip compose `redis`,
- if Redis is installed but stopped, start it or include `redis` in the compose infra command,
- if `6379` is occupied by a non-Redis process, set `HAPPYTG_REDIS_HOST_PORT` or free the port.

### Mini App says port 3001 is already in use

- if a HappyTG Mini App is already running, reuse it instead of starting a second copy,
- otherwise override the port with `HAPPYTG_MINIAPP_PORT=3002 pnpm dev:miniapp`,
- PowerShell: `$env:HAPPYTG_MINIAPP_PORT=3002; pnpm dev:miniapp`.

### Resume does not restore session

- inspect control plane event log,
- inspect host daemon local state,
- check idempotency key handling,
- verify the session has not been terminally completed or cancelled.

### Telegram shows stale state

- refresh materialized projections,
- ensure worker consumers are healthy,
- compare bot-rendered view with Mini App session history.
