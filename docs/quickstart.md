# Quickstart

## Goal

Get from an empty machine to a paired HappyTG host that can run a first Codex-backed task.

Use [Installation](./installation.md) if you need the fuller local/self-hosted setup, [Bootstrap Doctor](./bootstrap-doctor.md) if you want the bootstrap state model first, and [Configuration](./configuration.md) for env/runtime knobs.

## Preflight

- Run the one-command installer, or be ready to provide Git, Node.js 22+, `pnpm`, Codex CLI, and a real Telegram bot token manually.
- Decide whether you will reuse existing PostgreSQL / Redis / S3-compatible services, or start the local Compose shared infra.

## Happy Path

1. Run the installer shim.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/GermanMik/HappyTG/main/scripts/install/install.sh | bash
   ```

   PowerShell:

   ```powershell
   irm https://raw.githubusercontent.com/GermanMik/HappyTG/main/scripts/install/install.ps1 | iex
   ```

2. If the repo is already present locally, use the repo-local equivalent instead.

   ```bash
   pnpm happytg install
   ```

3. Start shared infra only. Do not run the full compose app stack and `pnpm dev` together.

   If `DATABASE_URL`, `REDIS_URL`, and `S3_ENDPOINT` already point at reachable services, skip Docker and continue to `pnpm dev`.

   If Redis is already running locally:

   ```bash
   docker compose --env-file .env -f infra/docker-compose.example.yml up postgres minio
   ```

   If Redis is missing or stopped:

   ```bash
   docker compose --env-file .env -f infra/docker-compose.example.yml up postgres redis minio
   ```

4. Start the repo services.

   ```bash
   pnpm dev
   ```

   Local `pnpm dev` does not require a public Telegram webhook. With the default local `HAPPYTG_PUBLIC_URL`, the bot auto-selects polling and should accept `/start` and `/pair <CODE>` directly from Telegram.

5. Request pairing on the execution host.

   ```bash
   pnpm daemon:pair
   ```

6. Send `/pair <CODE>` to the configured Telegram bot, then start the daemon.

   ```bash
   pnpm dev:daemon
   ```

7. Verify the local baseline before your first real task.

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm happytg verify
   ```

If you later want to remove the local bootstrap/daemon setup without deleting the repo checkout, run:

```bash
pnpm happytg uninstall
```

## What `pnpm dev` Starts

| Surface | Port | Expected startup signal |
| --- | --- | --- |
| Mini App | `3001` | `Mini App listening` |
| API | `4000` | `API listening` |
| Bot | `4100` | `Bot listening with Telegram polling active`, `Bot listening with Telegram webhook active`, or an explicit degraded/token warning |
| Worker probe | `4200` | `Worker probe server listening` |

The host daemon is separate from `pnpm dev`; start it with `pnpm dev:daemon` after pairing.

## If First Start Stops Here

| Signal | What it means | What to do next |
| --- | --- | --- |
| `telegramConfigured: false` | The bot did not get a valid Telegram token. | Rerun `pnpm happytg install` or set `TELEGRAM_BOT_TOKEN` in `.env`, then restart `pnpm dev:bot` or `pnpm dev`. |
| `Bot listening with degraded Telegram delivery` | The bot process is up, but Telegram update delivery is not usable in the selected mode. | Check `http://127.0.0.1:4100/ready`. For local dev, keep `TELEGRAM_UPDATES_MODE=auto` or set `TELEGRAM_UPDATES_MODE=polling`. For webhook mode, set a public HTTPS `HAPPYTG_PUBLIC_URL` and configure that webhook in Telegram. |
| `Codex CLI not found` | This shell cannot resolve Codex at all. | Verify `codex --version`, then rerun `pnpm happytg doctor`. |
| `Codex: detected but unavailable` | Codex was found, but startup failed in this shell. | Run `codex --version`, fix the local install/runtime, then rerun `pnpm happytg doctor --json`. |
| `Host is not paired yet` | Pairing has not been completed yet. | Run `pnpm daemon:pair`, send `/pair <CODE>` in Telegram, then start `pnpm dev:daemon`. |

## Port Overrides

| Service | Default | Override in `.env` | One-shot bash | One-shot PowerShell |
| --- | --- | --- | --- | --- |
| Mini App | `3001` | `HAPPYTG_MINIAPP_PORT=3002` | `HAPPYTG_MINIAPP_PORT=3002 pnpm dev:miniapp` | `$env:HAPPYTG_MINIAPP_PORT=3002; pnpm dev:miniapp` |
| API | `4000` | `HAPPYTG_API_PORT=4001` | `HAPPYTG_API_PORT=4001 pnpm dev:api` | `$env:HAPPYTG_API_PORT=4001; pnpm dev:api` |
| Bot | `4100` | `HAPPYTG_BOT_PORT=4101` | `HAPPYTG_BOT_PORT=4101 pnpm dev:bot` | `$env:HAPPYTG_BOT_PORT=4101; pnpm dev:bot` |
| Worker probe | `4200` | `HAPPYTG_WORKER_PORT=4201` | `HAPPYTG_WORKER_PORT=4201 pnpm dev:worker` | `$env:HAPPYTG_WORKER_PORT=4201; pnpm dev:worker` |
| Compose Redis host port | `6379` | `HAPPYTG_REDIS_HOST_PORT=6380` | `HAPPYTG_REDIS_HOST_PORT=6380 docker compose --env-file .env -f infra/docker-compose.example.yml up redis` | `$env:HAPPYTG_REDIS_HOST_PORT=6380; docker compose --env-file .env -f infra/docker-compose.example.yml up redis` |

If `3001` is already in use, run `pnpm happytg setup --json` first: if it reports an existing HappyTG Mini App, reuse it; if it names another listener, treat that as a conflict and choose `HAPPYTG_MINIAPP_PORT` or `PORT`.

If `4000` is already in use, reuse the running HappyTG API only when `pnpm happytg setup --json` identifies it as HappyTG API; otherwise treat the existing listener as a conflict and use `HAPPYTG_API_PORT` or `PORT`.

If `4100` is already in use, reuse the running HappyTG Bot only when `pnpm happytg setup --json` identifies it as HappyTG Bot; otherwise treat the existing listener as a conflict and use `HAPPYTG_BOT_PORT` or `PORT`.

If `4200` is already in use, reuse the running HappyTG Worker only when `pnpm happytg setup --json` identifies it as HappyTG Worker; otherwise treat the existing listener as a conflict and use `HAPPYTG_WORKER_PORT` or `PORT`.

Interactive `pnpm happytg install` follows the same rule set: it preflights the planned ports, shows the detected listener, offers 3 nearby free ports for real conflicts, and writes the explicit `HAPPYTG_*_PORT` choice back to `.env` before later startup guidance.

If `6379` is already in use:

- reuse the existing system Redis and skip compose `redis`;
- or point `REDIS_URL` at an existing reachable Redis instance;
- or set `HAPPYTG_REDIS_HOST_PORT` to a different host port before starting compose `redis`;
- or remove the published Redis port from the compose file if host access is not needed.

## What to Expect

- Telegram handles commands, approvals, and short summaries.
- Mini App shows richer task and artifact views.
- Repo-local proof artifacts are written to `.agent/tasks/<TASK_ID>/`.
- `pnpm happytg install` is the primary onboarding path; `pnpm happytg setup` remains the short first-run checklist; `pnpm happytg doctor --json` and `pnpm happytg verify --json` keep the detailed diagnostics.
- `pnpm happytg uninstall` removes local HappyTG bootstrap/runtime artifacts, including multiple recorded launcher surfaces from repeated installer runs in the same state scope, but intentionally keeps the repo checkout, `.env`, and any Compose-managed control-plane data.

## Next Reads

- [Installation](./installation.md)
- [Runtime Codex](./runtime-codex.md)
- [Proof Loop](./proof-loop.md)
