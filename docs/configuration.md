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
- `JWT_SIGNING_KEY`
- `CODEX_CLI_BIN`
- `CODEX_CONFIG_PATH`
- `HOST_DAEMON_MUTATION_QUEUE_CONCURRENCY`

## Policy Configuration

Policies are layered:

1. global
2. deployment
3. workspace
4. session
5. command

Lower layers may tighten but must not weaken higher layers.
