# HTG-2026-04-22-release-042-miniapp-port-projects Spec

## Scope

Release HappyTG `0.4.2` with a focused repair for Mini App public routing and Mini App project/session visibility.

## Acceptance Criteria

1. Docker Compose keeps the Mini App container listening on its internal container port even when the operator chose `HAPPYTG_MINIAPP_PORT=3007` for local/host access.
2. The Caddy skeleton does not force host-side `localhost:3001`; operators can point host-run Caddy at `127.0.0.1:3007`, while Docker Compose keeps the default `miniapp:3001` upstream.
3. Documentation explains the difference between local host port `3007`, Docker internal port `3001`, and Caddy upstream configuration.
4. Mini App session lists visibly identify Codex CLI sessions.
5. Mini App exposes projects/workspaces and allows creating a Codex CLI session from a selected project through authenticated Mini App flow.
6. Public Mini App auth and approval security are not weakened; Mini App project/session mutation routes require Mini App user context.
7. Release metadata is aligned at `0.4.2`, with changelog and release notes.

## Verification

- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/api test`
- `pnpm --filter @happytg/bootstrap test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm release:check --version 0.4.2`
- `pnpm happytg task validate --repo . --task HTG-2026-04-22-release-042-miniapp-port-projects`

## Out Of Scope

- Changing Telegram update delivery behavior.
- Replacing the Mini App UI framework.
- Making public Caddy expose generic private API routes.
- Automatically merging without passing release checks.
