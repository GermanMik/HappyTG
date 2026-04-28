# HTG-2026-04-28-release-docker-installer-compose

## Frozen Scope

Release the current Docker/installer Compose work on branch `codex/installer-docker-caddy-port80-repair` after additional verification and any minimal fixes required by those checks.

## In Scope

- Validate the accumulated Docker/installer changes currently in the worktree:
  - Docker launch port remapping and Caddy/observability port handling.
  - Existing `.env` confirmation behavior.
  - Windows installer pnpm shim handling.
  - Stable `happytg` Compose project/container naming.
- Run full repo checks plus targeted Docker Compose checks.
- Fix only real failures found by the verification pass.
- Commit, push, open/verify PR, and merge to the default branch if checks pass.
- Record release evidence and final verdict in this proof bundle.

## Out of Scope

- Renaming HappyTG packages, pnpm scripts, or Compose service IDs.
- Containerizing host-daemon.
- Reworking unrelated Mini App/API/Bot behavior.
- Reverting pre-existing user or prior-task changes unless they are directly required to make this release valid.

## Acceptance Criteria

- Local checks relevant to the changed surface pass, or environment-only warnings are documented.
- Docker Compose config/dry-run evidence shows stable `happytg` naming and preserved port remapping behavior.
- Release commit contains the intended Docker/installer/proof changes only.
- Branch is pushed and merged through GitHub after remote checks are acceptable.
