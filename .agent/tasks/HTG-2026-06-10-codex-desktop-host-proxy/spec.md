# HTG-2026-06-10-codex-desktop-host-proxy

## Scope

Implement a deployable Windows host-side Codex Desktop control proxy so Docker-hosted HappyTG API can request Codex Desktop actions through a local-only host service instead of trying to run `codex app-server` inside Docker.

## Acceptance

- `apps/host-daemon` exposes a local-only Codex Desktop proxy command.
- The proxy supports read/control operations needed by the existing Mini App/API Desktop flows.
- `packages/runtime-adapters` can use the proxy as a `CodexDesktopControlContract`.
- Docker/API users can enable the proxy through environment variables.
- Documentation explains how deployers run the Docker stack plus host-side proxy.
- Tests cover proxy request handling and adapter integration without calling a real Codex Desktop.

## Constraints

- Preserve the invariant that Telegram is not internal transport.
- Preserve serialized mutating host operations.
- Do not expose the proxy publicly; bind to loopback by default.
- Do not store secrets.
- Do not make git commits.
- Do not revert unrelated existing worktree changes.
