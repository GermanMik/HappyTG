# Troubleshooting

Use [Quickstart](./quickstart.md) for the standard first-run flow, [Bootstrap Doctor](./bootstrap-doctor.md) for state meanings, and [Configuration](./configuration.md) when the issue is clearly env- or path-related.

## Common Issues

| Symptom | Check | Next action |
| --- | --- | --- |
| Host cannot pair | `TELEGRAM_BOT_TOKEN`, pairing code TTL, host clock skew, API reachability | Reissue `pnpm daemon:pair` if needed, then send `/pair <CODE>` again. |
| Codex smoke check fails | `codex --version`, `~/.codex/config.toml`, network access required by Codex | Rerun `pnpm happytg doctor` and `pnpm happytg verify`; use `--json` when you need detailed stderr. |
| `Codex: detected but unavailable` | Codex binary exists but fails in this shell | Fix the local Codex install/runtime, then rerun `pnpm happytg doctor --json`. |
| Redis blocks first start | Redis state in the preflight summary | Reuse system Redis on `6379`, start Redis, or remap `HAPPYTG_REDIS_HOST_PORT`. |
| Mini App says port `3001` is already in use | Whether another HappyTG Mini App is already running | Reuse it, or override `HAPPYTG_MINIAPP_PORT`. |
| API says port `4000` is already in use | Whether HappyTG API is already serving `4000`, or another listener owns the port | Reuse the running API if it is already HappyTG, otherwise free the conflicting process or override `HAPPYTG_API_PORT`. |
| Resume does not restore session | Control plane event log, host daemon local state, idempotency state | Confirm the session was not already terminally completed or cancelled. |
| Telegram shows stale state | Worker health and projection freshness | Compare bot output with Mini App session history and refresh projections. |

## Example PowerShell Overrides

```powershell
$env:HAPPYTG_MINIAPP_PORT=3002; pnpm dev:miniapp
$env:HAPPYTG_API_PORT=4001; pnpm dev:api
$env:HAPPYTG_REDIS_HOST_PORT=6380; docker compose -f infra/docker-compose.example.yml up redis
```
