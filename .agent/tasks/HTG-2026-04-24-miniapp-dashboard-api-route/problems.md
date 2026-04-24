# Problems

## Fixed

- Public Caddy blocked `/api/v1/miniapp/dashboard` with `404` even though the API endpoint existed and enforced Mini App session auth.

## Remaining Notes

- `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile` was updated and reloaded because it is the active local/public Caddy deployment config. The repository source of truth was also updated in `infra/caddy/Caddyfile`.
- Public generic `/api/v1/tasks` still returns `404`; no broad public API route was introduced.
