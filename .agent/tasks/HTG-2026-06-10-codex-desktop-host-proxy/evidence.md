# Evidence

Status: passed.

## Initial Navigation

- EchoVault memories showed prior host-side 4001/3008 app-server control was needed because Docker could not access Windows Codex Desktop.
- Graphify query identified `apps/host-daemon/src/index.ts`, `apps/api/src/service.ts`, and `packages/runtime-adapters/src/codex-desktop.ts` as the relevant implementation nodes.

## Raw Outputs

- `raw/typecheck-runtime-adapters.txt`: `pnpm --filter @happytg/runtime-adapters typecheck`
- `raw/test-runtime-adapters.txt`
- `raw/typecheck-host-daemon.txt`: `pnpm --filter @happytg/host-daemon typecheck`
- `raw/test-host-daemon.txt`
- `raw/typecheck-api.txt`: `pnpm --filter @happytg/api typecheck`
- `raw/docker-compose-host-proxy-config-quiet.txt`: `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop-host-proxy.yml config --quiet`
- `raw/powershell-script-syntax.txt`: parser-only syntax check for `scripts/install-codex-desktop-proxy-task.ps1`

## Implementation Evidence

- Added `pnpm daemon:desktop-proxy` backed by `apps/host-daemon/src/codex-desktop-proxy.ts`.
- Added `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy` support to `packages/runtime-adapters/src/codex-desktop.ts`.
- Added Docker override `infra/docker-compose.codex-desktop-host-proxy.yml`.
- Added Windows Scheduled Task helper `scripts/install-codex-desktop-proxy-task.ps1`.
- Updated `.env.example`, `docs/configuration.md`, `docs/self-hosting.md`, and `infra/README.md`.
