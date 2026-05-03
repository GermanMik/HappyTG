# Evidence

## Change

The repair was made in operator-owned BaseDeploy, not HappyTG app code:

- `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile`
- `C:\Develop\Projects\BaseDeploy\docs\CADDY_SETUP.md`
- `C:\Develop\Projects\BaseDeploy\docs\happytg-caddy-identity-2026-05-02.md`
- `C:\Develop\Projects\HappyTG\docs\self-hosting.md`
- `C:\Develop\Projects\HappyTG\docs\troubleshooting.md`

The live Caddy config now has a `happytg_runtime` snippet, HappyTG site blocks for `443` and `8443`, and HappyTG path overrides before the HealthOS `https://:8443` catch-all.

HappyTG docs now call out the failure mode where an operator-owned reverse proxy returns HTTP 200 from the wrong fallback instead of HappyTG Mini App identity.

## Runtime Probes

- `local-443`: HTTP 200, `identity=HappyTG`.
- `local-8443`: HTTP 200, `identity=HappyTG`.
- `fallback-8443-host`: HTTP 200, `identity=HappyTG`.
- `public`: HTTP 200, `identity=HappyTG`.
- `scheduled-task-query-after-delete`: `schtasks.exe /Query /TN "HappyTG Host Daemon"` returned exit 1 with `ERROR: The system cannot find the file specified.`, confirming the stale task is absent after operator deletion.

Raw probe files are in `raw/local-443.txt`, `raw/local-8443.txt`, `raw/fallback-8443-host.txt`, and `raw/public.txt`.

## HappyTG CLI

- `pnpm happytg telegram menu set --dry-run`: PASS, Telegram Bot API not called.
- `pnpm happytg verify`: exit 0; Caddy route passes; remaining status is WARN because Codex websocket returns 403 and falls back to HTTP.

## Repo Checks

- `pnpm build`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0.

## Remaining Issues

- Codex CLI websocket 403 remains outside the HappyTG route fix; HappyTG verify treats it as a warning because the smoke check completes through HTTP fallback.
