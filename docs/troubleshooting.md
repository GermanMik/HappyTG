# Troubleshooting

## Common Issues

### Host cannot pair

- verify Telegram bot token and pairing code TTL,
- verify host clock skew,
- verify API reachability,
- verify refresh token persistence.

### Codex smoke check fails

- verify `codex` is in `PATH`,
- verify `~/.codex/config.toml` exists and is readable,
- verify network access required by Codex,
- rerun `pnpm happytg doctor` and `pnpm happytg verify` in the repository, or `happytg doctor` / `happytg verify` if the CLI is installed globally.

### Resume does not restore session

- inspect control plane event log,
- inspect host daemon local state,
- check idempotency key handling,
- verify the session has not been terminally completed or cancelled.

### Telegram shows stale state

- refresh materialized projections,
- ensure worker consumers are healthy,
- compare bot-rendered view with Mini App session history.
