# Project Memory Troubleshooting

## Hooks do not run after pull

- Run `.\scripts\install-git-hooks.ps1` from the repository root.
- Confirm `git config core.hooksPath` prints `.githooks`.
- Confirm `.githooks/post-merge` and `.githooks/post-checkout` exist in the checkout.

## `memory` CLI is not available

The hooks still succeed. They print changed project memory files and skip the optional EchoVault pointer record.

## A memory update was already recorded

`scripts/after-pull-memory-sync.ps1` deduplicates EchoVault saves through `.git/project-memory-sync-state.json`. Re-running the same hook for the same commit and file list should not create another record.

## Codex Desktop controls fall back to unsupported after API rebuild

When rebuilding or restarting only the Docker `api` service for Codex Desktop host-proxy work, include both Desktop overrides:

```powershell
docker compose --env-file .env `
  -f infra\docker-compose.example.yml `
  -f infra\docker-compose.codex-desktop.yml `
  -f infra\docker-compose.codex-desktop-host-proxy.yml `
  up -d --build api
```

Using only `infra\docker-compose.codex-desktop.yml` preserves the read-only `/codex-home` mount but omits `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy`, so API reports `CODEX_DESKTOP_CONTROL_UNSUPPORTED` even while `pnpm daemon:desktop-proxy` is healthy.
