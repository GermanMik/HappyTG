# HTG-2026-06-10-docker-4001-3008-runtime

## Scope

Move the HappyTG public Mini App runtime from manual background `pnpm` processes to Docker Compose so the existing external Caddy route can survive normal Docker restarts.

## Acceptance

- Docker publishes HappyTG API on host port `4001`.
- Docker publishes HappyTG Mini App on host port `3008`.
- Docker API can read Codex Desktop projects through an explicit read-only host `.codex` mount.
- `infra/docker-compose.example.yml` uses restart policy for runtime services.
- Manual host-side `pnpm` listeners on `4001/3008` are stopped before Docker binds those ports.
- Public `https://happytg.gerta.crazedns.ru/miniapp/ready` returns `200 OK`.
- `pnpm happytg verify` sees API/Mini App on `4001/3008` as reused services.

## Constraints

- Keep the external BaseDeploy Caddy contract: public HappyTG routes still proxy to host `127.0.0.1:4001` and `127.0.0.1:3008`.
- Keep broad public `/api/*` blocked.
- Do not make git commits.
- Do not store or print secrets.
- Do not enable mutating Codex Desktop `app-server` control inside Docker unless that contract is separately proven.
