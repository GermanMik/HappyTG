# Task Spec

- Task ID: HTG-2026-05-03-docker-corepack-pnpm-retry
- Title: Docker app image pnpm activation retry
- Owner: HappyTG
- Mode: proof
- Status: frozen
- Frozen by: Codex task-spec-freezer
- Frozen at: 2026-05-03T00:00:00+03:00

## Problem

Installer Docker launch mode failed while building the shared app image. The failing command was `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d --no-deps api worker bot miniapp prometheus grafana`. The Docker build reached `RUN pnpm install --frozen-lockfile`, then Corepack attempted to lazily download `pnpm@10.0.0` from `registry.npmjs.org` and aborted on a transient TLS `ECONNRESET`. Because this happens inside the shared app image, one failed service build cancels the parallel API, worker, bot, and Mini App builds.

## Acceptance Criteria

1. The shared Docker app image activates the pinned pnpm version before dependency installation instead of relying on a lazy Corepack download during `pnpm install`.
2. The pnpm activation step tolerates transient registry/network failures with bounded retries.
3. The image keeps using the repository-pinned `pnpm@10.0.0` and `pnpm install --frozen-lockfile`.
4. The fix is limited to Docker build reliability and does not change installer launch semantics, service selection, ports, host-daemon behavior, or application runtime contracts.
5. Targeted verification proves the Dockerfile is syntactically/build-wise valid enough to pass the prior failing pnpm activation/download point.
6. Proof artifacts record the command output and a fresh verification verdict.

## Out Of Scope

- Changing the installer UX or launch-mode flow.
- Rewriting Docker Compose service topology.
- Changing package manager versions or lockfile contents.
- Mutating operator-owned Caddy configuration.
- Starting, stopping, or deleting persistent infrastructure data outside the requested Compose startup path.

## Verification Plan

- Inspect `infra/Dockerfile.app` before edits.
- Patch only the Dockerfile if possible.
- Run a targeted Docker build for one app target with plain progress and record output under `raw/build.txt`.
- Run `docker compose --env-file .env -f infra/docker-compose.example.yml config` and record output under `raw/compose-config.txt`.
- Run targeted test/lint/typecheck commands only if code changes extend beyond Dockerfile/docs; otherwise record them as not applicable.
- Run a fresh read-only verification pass against this spec and write `problems.md` and `verdict.json`.
