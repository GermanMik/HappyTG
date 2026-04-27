# HTG-2026-04-28-installer-docker-caddy-port80

## Frozen Scope

Repair Docker launch installer port preflight so host port conflicts for every host port published by `infra/docker-compose.example.yml` are detected and handled before `docker compose up --build -d`.

## In Scope

- Inspect Compose-published host ports and the installer "Resolve planned ports" flow.
- Add minimal planned-port coverage for Caddy HTTP/HTTPS:
  - `HAPPYTG_HTTP_PORT`, default `80`
  - `HAPPYTG_HTTPS_PORT`, default `443`
- Add planned-port coverage for other uncovered Compose-published ports if confirmed:
  - `HAPPYTG_PROMETHEUS_PORT`, default `9090`
  - `HAPPYTG_GRAFANA_PORT`, default `3000`
- Preserve existing Docker launch remap behavior for Redis, PostgreSQL, and MinIO.
- Improve bind-failure detail so the failed port and env override are obvious.
- Keep final guidance truthful when Caddy is remapped away from public 80/443.
- Verify with focused bootstrap tests, typecheck, build, lint, task validation, and a fresh verifier pass.

## Out of Scope

- Removing Caddy from the packaged Compose stack.
- Skipping Caddy after bind failure.
- Rewriting installer architecture or Docker topology.
- Treating arbitrary services on port 80 as valid HappyTG Caddy routes.
- Investigating Codex CLI websocket 403 warnings unless they block required verification.

## Acceptance Criteria

1. Docker launch preflight covers all default host ports published by the Compose stack, including Caddy.
2. Port 80 and 443 conflicts are handled through saved `.env` overrides before Compose startup.
3. Saved `.env` overrides are used by the same Compose command the installer runs.
4. Installer output distinguishes local startup from public Telegram/Caddy readiness when public ports are remapped.
5. HappyTG-owned partial Compose containers are not reported as unsupported external reuse.
6. Required verification commands pass or any environmental blocker is documented with evidence.
