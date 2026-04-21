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
- `HAPPYTG_PUBLIC_URL`
- `HAPPYTG_DOMAIN`
- `CADDY_ACME_EMAIL`
- `HAPPYTG_DEV_CORS_ORIGINS`
- `JWT_SIGNING_KEY`
- `CODEX_CLI_BIN`
- `CODEX_CONFIG_PATH`
- `HOST_DAEMON_MUTATION_QUEUE_CONCURRENCY`
- `HAPPYTG_MINIAPP_PORT`
- `HAPPYTG_API_PORT`
- `HAPPYTG_BOT_PORT`
- `HAPPYTG_WORKER_PORT`
- `HAPPYTG_REDIS_HOST_PORT`

## Policy Configuration

Policies are layered:

1. global
2. deployment
3. workspace
4. project
5. session
6. command

Lower layers may tighten but must not weaken higher layers.

## Telegram Delivery Configuration

- `TELEGRAM_UPDATES_MODE=auto` is the default.
- `auto` selects polling when `HAPPYTG_PUBLIC_URL` is local, private, missing, or not HTTPS.
- `auto` selects webhook when `HAPPYTG_PUBLIC_URL` is a public HTTPS URL.
- `polling` is the intended local-dev mode when you do not want to expose a public webhook.
- `webhook` keeps the bot in webhook-first mode and reports degraded readiness if the expected public webhook is not actually configured at Telegram.

## Mini App CORS Configuration

- `HAPPYTG_DEV_CORS_ORIGINS` is a comma-separated development allowlist for local or tunnel Mini App origins.
- Production must stay strict: do not use wildcard CORS for `happytg.gerta.crazedns.ru`.
- The API applies this allowlist only outside `NODE_ENV=production`; same-origin production routing through Caddy should not require wildcard CORS.

## Mini App Launch and Session Configuration

- `MINIAPP_INITDATA_MAX_AGE_SECONDS` controls how old Telegram Mini App `initData` may be before the backend rejects it.
- `MINIAPP_LAUNCH_GRANT_TTL_SECONDS` controls server-issued launch grant expiry for `startapp` payloads.
- `MINIAPP_SESSION_TTL_SECONDS` controls short-lived backend Mini App session tokens.
- `HAPPYTG_MINIAPP_LAUNCH_SECRET` signs compact launch payloads. If empty, HappyTG falls back to `JWT_SIGNING_KEY`; production deployments should set it explicitly and rotate it with normal secret procedures.
- The Mini App frontend stores only local draft state and the short-lived app-session token. Backend remains the source of truth for sessions, approvals, hosts, proof bundles, diff, and verify state.
