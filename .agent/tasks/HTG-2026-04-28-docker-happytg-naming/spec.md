# HTG-2026-04-28-docker-happytg-naming

## Frozen Scope

Change Docker Compose naming for the primary HappyTG Docker stack so clean launches use a stable `happytg`-oriented Compose project/container name instead of directory-derived or otherwise unstable names.

## In Scope

- Inspect Docker Compose configuration, installer Docker launch code, and user-facing documentation for Docker startup naming behavior.
- Prefer a stable Compose project name such as `COMPOSE_PROJECT_NAME=happytg` through Compose config or installer/env wiring.
- Preserve existing service identifiers, package names, pnpm scripts, Docker launch modes, port remapping, and reuse of local Redis/Postgres/S3.
- Keep `apps/host-daemon` outside Docker Compose.
- Update documentation or installer hints only where users see Docker container names.
- Record command outputs and naming evidence under this proof bundle.

## Out of Scope

- Renaming the repository, packages, npm/pnpm scripts, or Compose service IDs.
- Adding per-service `container_name` unless Compose project naming cannot satisfy the requirement safely.
- Containerizing host-daemon.
- Reworking Docker launch architecture, health checks, or dependency provisioning beyond naming.

## Acceptance Criteria

- `docker compose config` shows stable HappyTG project/container naming.
- Existing Docker launch flow produces names with `happytg` in the project/container naming format.
- Old directory-derived/random Compose names are not used for the main HappyTG stack.
- Relevant bootstrap typecheck/tests pass, or any blocker is documented.
- `evidence.md` lists the observed Compose project and container names.
