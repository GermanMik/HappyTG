# Quickstart

## Goal

Get from an empty machine to a paired HappyTG host that can run a first Codex-backed task.

Use [Installation](./installation.md) if you need the fuller local/self-hosted setup, [Bootstrap Doctor](./bootstrap-doctor.md) if you want the bootstrap state model first, and [Configuration](./configuration.md) for env/runtime knobs.

## Preflight

- Install Git, Node.js 22+, `pnpm`, and Codex CLI.
- Create `.env` from `.env.example`.
- Put a real `TELEGRAM_BOT_TOKEN` into `.env`.
- Decide whether you will reuse a system Redis on `6379` or start compose `redis`.

## Happy Path

1. Create `.env`.

   ```bash
   cp .env.example .env
   ```

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Fill the Telegram bot token, install dependencies, and run the guided preflight.

   ```bash
   pnpm install
   pnpm happytg setup
   ```

3. Start shared infra only. Do not run the full compose app stack and `pnpm dev` together.

   If Redis is already running locally:

   ```bash
   docker compose -f infra/docker-compose.example.yml up postgres minio
   ```

   If Redis is missing or stopped:

   ```bash
   docker compose -f infra/docker-compose.example.yml up postgres redis minio
   ```

4. Start the repo services.

   ```bash
   pnpm dev
   ```

5. Request pairing on the execution host.

   ```bash
   pnpm daemon:pair
   ```

6. Send `/pair <CODE>` to the Telegram bot, then start the daemon.

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

## What `pnpm dev` Starts

| Surface | Port | Expected startup signal |
| --- | --- | --- |
| Mini App | `3001` | `Mini App listening` |
| API | `4000` | `API listening` |
| Bot | `4100` | `Bot listening` or a short Telegram token warning |
| Worker probe | `4200` | `Worker probe server listening` |

The host daemon is separate from `pnpm dev`; start it with `pnpm dev:daemon` after pairing.

## If First Start Stops Here

| Signal | What it means | What to do next |
| --- | --- | --- |
| `telegramConfigured: false` | The bot did not get a valid Telegram token. | Set `TELEGRAM_BOT_TOKEN` in `.env`, then restart `pnpm dev:bot` or `pnpm dev`. |
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
| Compose Redis host port | `6379` | `HAPPYTG_REDIS_HOST_PORT=6380` | `HAPPYTG_REDIS_HOST_PORT=6380 docker compose -f infra/docker-compose.example.yml up redis` | `$env:HAPPYTG_REDIS_HOST_PORT=6380; docker compose -f infra/docker-compose.example.yml up redis` |

If `3001` is already in use, pick a different `HAPPYTG_MINIAPP_PORT`.

If `6379` is already in use:

- reuse the existing system Redis and skip compose `redis`;
- or set `HAPPYTG_REDIS_HOST_PORT` to a different host port before starting compose `redis`;
- or remove the published Redis port from the compose file if host access is not needed.

## What to Expect

- Telegram handles commands, approvals, and short summaries.
- Mini App shows richer task and artifact views.
- Repo-local proof artifacts are written to `.agent/tasks/<TASK_ID>/`.
- `pnpm happytg setup` shows the short first-run checklist; `pnpm happytg doctor --json` and `pnpm happytg verify --json` keep the detailed diagnostics.

## Next Reads

- [Installation](./installation.md)
- [Runtime Codex](./runtime-codex.md)
- [Proof Loop](./proof-loop.md)
