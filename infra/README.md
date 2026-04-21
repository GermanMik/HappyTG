# Infrastructure

This directory contains self-hosted deployment helpers.

- [Docker Compose Example](./docker-compose.example.yml): local single-user deployment example.
- [Shared App Dockerfile](./Dockerfile.app): generic Node + pnpm runtime image for API, worker, bot, and Mini App surfaces.
- [Caddyfile](./caddy/Caddyfile): path-based public topology skeleton for `happytg.gerta.crazedns.ru`.
- [Prometheus config](./prometheus/prometheus.yml): internal scrape config for API `/metrics`.
- [Grafana provisioning](./grafana/provisioning/): Prometheus datasource scaffold.
- [DB migrations](./db/migrations/): reserved migration directory for the future PostgreSQL schema.
- Reverse proxy, migration, backup, and upgrade guidance lives in [Self-Hosting](../docs/self-hosting.md).
- host daemon is intentionally not part of the compose stack and should run on the execution host that owns the workspace.
- For local development, use compose for shared infra and `pnpm dev` for repo services; do not run the full compose app stack and `pnpm dev` together unless you intentionally remap the ports.
