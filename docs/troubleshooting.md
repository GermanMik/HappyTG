# Troubleshooting

Use [Quickstart](./quickstart.md) for the standard first-run flow, [Bootstrap Doctor](./bootstrap-doctor.md) for state meanings, and [Configuration](./configuration.md) when the issue is clearly env- or path-related.

## Common Issues

| Symptom | Check | Next action |
| --- | --- | --- |
| Host cannot pair | `TELEGRAM_BOT_TOKEN`, pairing code TTL, host clock skew, API reachability | Reissue `pnpm daemon:pair` if needed, then send `/pair <CODE>` again. |
| Codex smoke check fails | `codex --version`, `~/.codex/config.toml`, network access required by Codex | Rerun `pnpm happytg doctor` and `pnpm happytg verify`; use `--json` when you need detailed stderr. |
| `Codex: detected but unavailable` | Codex binary exists but fails in this shell | Fix the local Codex install/runtime, then rerun `pnpm happytg doctor --json`. |
| Redis blocks first start | Redis state in the preflight summary | Reuse system Redis on `6379`, start Redis, or remap `HAPPYTG_REDIS_HOST_PORT`. |
| Installer says pnpm ignored build scripts | Whether HappyTG reports the critical `tsx` + `esbuild` path as usable or broken after `pnpm install` | If the installer says the toolchain is usable, continue with the explicit warning only. If it says the toolchain is broken, follow the runtime-specific pnpm guidance it prints, rebuild the affected package(s), then rerun `pnpm happytg install` or `pnpm happytg doctor --json`. |
| Mini App says port `3001` is already in use | Whether `pnpm happytg setup --json` identifies HappyTG Mini App or another listener on `3001` | Reuse the running Mini App only when setup identifies HappyTG Mini App there; otherwise treat it as a conflict and override `HAPPYTG_MINIAPP_PORT` or `PORT`. |
| API says port `4000` is already in use | Whether `pnpm happytg setup --json` identifies HappyTG API or another listener on `4000` | Reuse the running API only when setup identifies HappyTG API there; otherwise treat it as a conflict and override `HAPPYTG_API_PORT` or `PORT`. |
| Bot says port `4100` is already in use | Whether `pnpm happytg setup --json` identifies HappyTG Bot or another listener on `4100` | Reuse the running Bot only when setup identifies HappyTG Bot there; otherwise treat it as a conflict and override `HAPPYTG_BOT_PORT` or `PORT`. |
| Worker says port `4200` is already in use | Whether `pnpm happytg setup --json` identifies HappyTG Worker or another listener on `4200` | Reuse the running Worker only when setup identifies HappyTG Worker there; otherwise treat it as a conflict and override `HAPPYTG_WORKER_PORT` or `PORT`. |
| Need to remove local HappyTG bootstrap/daemon state | Whether you only want to clean local launcher/state artifacts or also stop packaged control-plane services | Run `pnpm happytg uninstall` for local cleanup. It keeps the repo checkout and `.env`; stop `docker compose` separately if you also need to shut down the packaged control plane. |
| Resume does not restore session | Control plane event log, host daemon local state, idempotency state | Confirm the session was not already terminally completed or cancelled. |
| Telegram shows stale state | Worker health and projection freshness | Compare bot output with Mini App session history and refresh projections. |

## Example PowerShell Overrides

```powershell
$env:HAPPYTG_MINIAPP_PORT=3002; pnpm dev:miniapp
$env:HAPPYTG_API_PORT=4001; pnpm dev:api
$env:HAPPYTG_REDIS_HOST_PORT=6380; docker compose --env-file .env -f infra/docker-compose.example.yml up redis
```

Interactive `pnpm happytg install` now surfaces the same port classification before later startup guidance and lets you pick one of the nearest free ports, enter a custom port, or abort instead of silently rebinding.
