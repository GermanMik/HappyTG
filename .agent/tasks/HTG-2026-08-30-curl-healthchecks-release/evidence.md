# Evidence Bundle: HTG-2026-08-30-curl-healthchecks-release

## Summary
- Overall status: UNKNOWN (AC5 pending Git publication and release workflow)
- Last updated: 2026-08-30T17:13:00+03:00

## Acceptance criteria evidence

### AC1
- Status: PASS
- Proof:
  - `infra/Dockerfile.app` installs `curl` using `apt-get install -y --no-install-recommends curl` and removes `/var/lib/apt/lists/*` in the same layer.
  - Four rebuilt app images completed successfully; the resulting API image exposes `curl 7.88.1`.
- Gaps:
  - None.

### AC2
- Status: PASS
- Proof:
  - `infra/docker-compose.example.yml` contains exactly four app probes using `curl -fsS --max-time 4` against ports `4000`, `4200`, `4100`, and `3001`.
  - Each app probe has `interval: 30s`; no app healthcheck uses `node -e`.
  - `docker inspect` on all four running containers confirms the same test and interval.
- Gaps:
  - None.

### AC3
- Status: PASS
- Proof:
  - `tsx --test packages/bootstrap/src/infra-config.test.ts` exited 0 with 12/12 tests passing.
  - `tsc -p packages/bootstrap/tsconfig.json --noEmit` exited 0.
  - `docker compose --env-file .env -f infra/docker-compose.example.yml -f infra/docker-compose.codex-desktop.yml -f infra/docker-compose.codex-desktop-host-proxy.yml config --quiet` exited 0.
  - Four final app image builds completed with exit 0.
  - After restart, `happytg-api-1`, `happytg-worker-1`, `happytg-bot-1`, and `happytg-miniapp-1` were `healthy`; all four local `/ready` calls returned JSON with `ok: true`.
  - API retained `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy`.
- Gaps:
  - None for local runtime proof.

### AC4
- Status: PASS
- Proof:
  - All 16 workspace `package.json` files report version `0.4.31`.
  - `CHANGELOG.md` contains `## v0.4.31`.
  - `docs/releases/0.4.31.md` contains the required heading and version bullet.
  - `node scripts/release/validate-release.mjs --version 0.4.31` exited 0.
- Gaps:
  - None.

### AC5
- Status: UNKNOWN
- Proof:
  - Current branch is `codex/miniapp-cpu-optimization` and has not yet been committed or pushed for this release.
- Gaps:
  - Commit, push, merge into the default branch, and GitHub Release `v0.4.31` are still pending.

## Commands run
- `tsx --test packages/bootstrap/src/infra-config.test.ts` — exit 0, 12/12 passed.
- `pnpm typecheck` — exit 0, 15/15 tasks successful.
- `pnpm lint` — exit 0, 15/15 tasks successful.
- `pnpm test` — exit 0, 15/15 tasks successful.
- `pnpm build` — exit 0, 15/15 tasks successful.
- `tsc -p packages/bootstrap/tsconfig.json --noEmit` — exit 0.
- `node scripts/release/validate-release.mjs --version 0.4.31` — exit 0.
- `git diff --check` — exit 0; line-ending warnings only.
- `docker compose ... config --quiet` — exit 0.
- `docker compose ... build api worker bot miniapp` — exit 0 across all four images (worker retried separately after bounded transient stall).
- `docker compose ... up -d --no-deps api worker bot miniapp` — exit 0.
- `docker ps`, `docker inspect`, and four in-container `curl ... /ready` probes — all healthy/`ok: true`.

## Raw artifacts
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/build.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/test-unit.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/test-integration.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/lint.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/typecheck.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/lint-full.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/test-full.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/build-full.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/release-check.txt
- .agent/tasks/HTG-2026-08-30-curl-healthchecks-release/raw/diff-check.txt

## Known gaps
- AC5 remains pending until the release commit is on the default branch and GitHub Release `v0.4.31` is verified.
