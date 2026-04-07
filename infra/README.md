# Infrastructure

This directory contains self-hosted deployment helpers.

- `docker-compose.example.yml`: local single-user deployment example.
- `Dockerfile.app`: generic Node + pnpm runtime image for API, worker, bot, and Mini App surfaces.
- reverse proxy, migration, backup, and upgrade guidance lives in `docs/self-hosting.md`.
- host daemon is intentionally not part of the compose stack and should run on the execution host that owns the workspace.
