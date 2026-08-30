# Task Spec: HTG-2026-08-30-curl-healthchecks-release

## Metadata
- Task ID: HTG-2026-08-30-curl-healthchecks-release
- Created: 2026-08-30T16:52:14+00:00
- Repo root: C:\Develop\Projects\HappyTG
- Working directory at init: C:\Develop\Projects\HappyTG

## Guidance sources
- AGENTS.md
- CLAUDE.md

## Original task statement
Replace Node Docker readiness probes with curl and 30-second intervals, rebuild/restart the four HappyTG app services, then commit, push, and publish HappyTG 0.4.31.

## Acceptance criteria
- AC1: `infra/Dockerfile.app` installs `curl` in the shared runtime image with apt metadata cleanup.
- AC2: API, worker, bot, and Mini App Compose healthchecks use `curl -fsS --max-time 4` against their existing `/ready` endpoints and run every `30s`; no app healthcheck invokes `node -e`.
- AC3: The changed Compose contract is covered by passing targeted tests, TypeScript validation, and `docker compose config --quiet`; the four rebuilt app containers are healthy and each `/ready` endpoint returns `ok: true` after restart.
- AC4: All workspace package versions, `CHANGELOG.md`, and `docs/releases/0.4.31.md` are aligned for release `0.4.31`, and release metadata validation passes.
- AC5: Changes are committed, pushed, merged into the default branch, and the guarded GitHub Release `v0.4.31` is created from the latest default-branch commit.

## Constraints
- Preserve the existing Desktop override files, including `infra/docker-compose.codex-desktop-host-proxy.yml` and `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy`.
- Recreate only the four app services; do not restart Postgres, Redis, MinIO, Caddy, Prometheus, or Grafana.
- Keep `/ready` HTTP semantics; do not replace readiness with a port-only probe.
- Do not include secrets, local credentials, or unrelated worktree changes.
- Do not create a Git commit until the required local verification is passing.

## Non-goals
- No changes to application request handling, policy, approvals, Telegram transport, or Desktop control logic.
- No Docker Compose production deployment beyond the explicitly requested local app-service restart.
- No unrelated dependency upgrades or architecture changes.

## Verification plan
- Build: build all four app images with the three existing Compose files; confirm `curl` is available in the resulting image.
- Unit tests: run `tsx --test packages/bootstrap/src/infra-config.test.ts`.
- Integration tests: run `docker compose ... config --quiet`, recreate the four app services, inspect health status, and call all four `/ready` endpoints with `curl`.
- Lint: run `tsc -p packages/bootstrap/tsconfig.json --noEmit` and `git diff --check`.
- Release checks: bump all workspace versions to `0.4.31`, run `node scripts/release/validate-release.mjs --version 0.4.31`, commit/push/merge, verify upstream containment, then dispatch `.github/workflows/release.yml` with version `0.4.31`, draft `false`, prerelease `false` and inspect the resulting release.
