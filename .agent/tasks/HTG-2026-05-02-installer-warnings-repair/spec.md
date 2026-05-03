# HTG-2026-05-02-installer-warnings-repair

## Frozen Scope

Repair the warnings from the local HappyTG installer summary without changing HappyTG application code unless repo evidence shows it is required.

## Acceptance Criteria

- Public `https://happytg.gerta.crazedns.ru/miniapp` returns HTTP 200 with HappyTG Mini App identity.
- `pnpm happytg telegram menu set --dry-run` passes without calling Telegram Bot API.
- `pnpm happytg verify` exits 0 and reports the Caddy Mini App route as HappyTG.
- Full repo checks pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- BaseDeploy Caddy documentation records the repaired HappyTG route and remaining warnings.
- Stale Scheduled Task state is checked; after operator deletion, the task is verified absent.

## Out Of Scope

- Creating a mobile APK.
- Changing Telegram Bot API state with a non-dry-run menu update.
- Performing elevated Windows Scheduled Task deletion directly from the agent shell.
- Fixing external Codex websocket 403 behavior when the CLI fallback still completes.
