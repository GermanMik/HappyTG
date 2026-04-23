# Task Spec

- Task ID: HTG-2026-04-23-installer-docker-launch-mode
- Title: Installer Docker launch mode
- Owner: HappyTG
- Mode: proof
- Status: frozen
- Frozen by: task-spec-freezer
- Frozen at: 2026-04-23T16:21:33.720Z

## Problem

`pnpm happytg install` prepares a checkout, dependencies, `.env`, Telegram settings, port preflight, host-daemon background preference, and optional post-checks, but it does not expose Docker Compose startup as a first-class install decision. Operators can currently infer full-stack Compose from docs, while the installer still mostly points at local `pnpm dev`. Add an explicit, safe launch choice that can start the packaged control-plane stack through `infra/docker-compose.example.yml` without making Docker required, without replacing local development, and without hiding that `apps/host-daemon` remains host-run.

## Acceptance Criteria

1. Installer UX exposes an explicit Docker Compose launch option.
2. Non-interactive installs can request Docker launch through a documented flag.
3. Docker is not required for local install or existing-service reuse.
4. Compose startup never includes the host daemon.
5. Final output separates Compose control-plane startup from host-daemon pairing/startup.
6. Port conflict handling and Mini App port semantics are preserved.
7. Verification passes and a fresh verifier pass confirms the task.
8. Docs explain pnpm dev, Docker Compose, and manual startup choices.

## Required Design Decisions

- Exact launch-mode enum/API: add `InstallLaunchMode = "local" | "docker" | "manual" | "skip"`. CLI exposes `--launch-mode local|docker|manual|skip`; `InstallCommandOptions.launchMode`, `InstallDraftState.launchMode`, and `InstallResult.launch` carry the decision and execution result.
- Default interactive choice: `local`, because it preserves the existing local developer path and does not start containers implicitly.
- Non-interactive default when no launch mode is passed: `local`, for backward-compatible final guidance. Only `--launch-mode docker` may start Docker.
- Post-check order: env merge and planned-port preflight run before any launch; Docker Compose validation/start/health runs after host-daemon background preference is configured and before selected post-checks. The cached preflight `setup` report is invalidated after Docker launch so post-checks can observe the launched stack.
- Compose validation/start/health representation: `InstallResult.launch` records mode, status, detail, compose file, exact command strings, command outcomes, health checks, warnings, and next-step hints. The install step `launch` mirrors this as `passed`, `warn`, `failed`, or `skipped`.
- Host-daemon pairing after Docker startup: finalization keeps pairing and `pnpm dev:daemon`/background-launch guidance outside Compose. Docker finalization says Compose started the control-plane stack and explicitly says the host daemon still runs on the host.
- Prevent misleading Docker advice when Docker is unavailable: Docker binary missing, Compose plugin missing, daemon/Desktop unavailable, config failure, up/build failure, and health failure are classified in the Docker launch result with actionable next steps. Local/manual/skip modes do not require Docker and must not warn just because Docker is absent.
- Preserve non-Docker service reuse paths: existing `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, and port-preflight reuse behavior remain untouched. Compose-specific defaults continue to use `COMPOSE_DATABASE_URL`, `COMPOSE_REDIS_URL`, and `COMPOSE_S3_ENDPOINT`; installer docs explain external-service reuse separately from Docker launch.

## Constraints

- Runtime: Codex CLI.
- Builder and verifier roles are separate proof-loop phases; verifier does not edit production code.
- Production edits must be minimal and scoped to installer launch mode, tests, docs, and only Compose changes proven necessary.
- Do not containerize `apps/host-daemon`.
- Do not imply Docker replaces local Codex CLI installation on execution hosts.
- Do not run full Compose and `pnpm dev` together on the same default ports.
- Do not weaken port conflict classification or public Mini App URL validation.
- Do not hardcode production domains, bot tokens, user IDs, credentials, or local machine paths.
- Do not make Docker required for local development or existing-service reuse.
- Do not run destructive Docker commands such as `down -v`, volume removal, image pruning, or data deletion.
- Keep `HAPPYTG_MINIAPP_UPSTREAM` unset for Docker-network Caddy; preserve Mini App container listener `3001` with host `HAPPYTG_MINIAPP_PORT` mapping.

## Verification Plan

- Unit: bootstrap CLI/parser tests for valid and invalid `--launch-mode`, render output, TUI render, and installer runtime behavior.
- Unit: installer runtime tests prove default/local modes do not run Docker; non-interactive docker mode runs `docker compose config`, `up --build -d`, `ps`, and health probes in the selected repo path.
- Unit: Docker missing or daemon unavailable yields recoverable output and actionable next steps; Docker launch finalization still tells operators to pair/start the host daemon outside Compose.
- Unit: local launch still recommends `pnpm dev`, `pnpm daemon:pair`, and `pnpm dev:daemon`; port preflight can save `HAPPYTG_*_PORT` overrides before Docker launch.
- Unit/docs: Mini App host-port override remains `${HAPPYTG_MINIAPP_PORT:-3001}:3001` and internal container listener remains `3001`; publish bot port only if required for host readiness.
- Commands: `pnpm --filter @happytg/bootstrap run test`, `typecheck`, `build`, `lint`, and `pnpm happytg task validate --repo . --task HTG-2026-04-23-installer-docker-launch-mode`.
- Fresh verifier: read frozen spec, inspect diff, review proof artifacts, run/confirm required command outputs, and write `verdict.json`/`problems.md` without editing production code.

