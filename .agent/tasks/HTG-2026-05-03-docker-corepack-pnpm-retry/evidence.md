# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed
- `complete`: completed

## Commands Run

- `memory context --project` -> session start context retrieved
- `memory search "Docker Compose Corepack pnpm Dockerfile app ECONNRESET installer"` -> prior Docker installer context found
- `memory details 4edbc64f-031` and related details -> prior Docker launch-mode decisions reviewed
- `docker compose --env-file .env -f infra/docker-compose.example.yml config` -> passed; release branch omits raw output to avoid publishing environment-shaped compose material.
- `docker build --progress=plain --build-arg APP_PACKAGE='@happytg/bot' -f infra/Dockerfile.app -t happytg .` -> passed.
- `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d --no-deps api worker bot miniapp prometheus grafana` -> failed once on Docker Hub base-image metadata EOF.
- same Compose command retried -> passed.
- `docker compose --env-file .env -f infra/docker-compose.example.yml ps` -> passed; API, bot, miniapp, worker are healthy/running.
- `docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | Select-String -Pattern "happytg"` -> passed; includes `happytg:latest`.
- `pnpm happytg doctor --json` -> passed with `status: "pass"` and no findings.
- `pnpm happytg verify --json` -> passed with `status: "pass"` and no findings.
- `pnpm happytg task validate --repo . --task HTG-2026-05-03-docker-corepack-pnpm-retry` -> passed.

## Code Changes

- `infra/Dockerfile.app`
  - reads the repository-pinned package manager from `package.json`
  - runs `corepack prepare "$PNPM_SPEC" --activate` before copying app/package sources
  - wraps pnpm activation in three bounded attempts with short backoff
  - keeps `pnpm install --frozen-lockfile` unchanged

## Runtime Findings

- The original failure path was not reproduced after the patch. The targeted Docker build showed `corepack prepare pnpm@10.0.0 --activate`, `pnpm --version` returning `10.0.0`, and the later `pnpm install --frozen-lockfile` completing without Corepack's lazy pnpm download.
- The targeted verification image is tagged as `happytg:latest`; the temporary `happytg-app-pnpm-retry-test:latest` tag was removed from the local Docker image list.
- A first full Compose retry failed earlier on Docker Hub base image metadata with `EOF`. A second run of the same command succeeded. This is separate from the pnpm activation failure and confirms registry connectivity is still intermittently unstable on this host.
- During the successful Compose build, pnpm itself retried an `esbuild` tarball `ECONNRESET` and recovered. The critical gap was that Corepack's pnpm download did not have equivalent retry behavior; the new Dockerfile layer supplies bounded retries there.
- `docker compose ps` reported API, Bot, Mini App, Worker, Redis, and Postgres healthy; Grafana, Prometheus, and MinIO were running.
- `pnpm happytg doctor --json` and `pnpm happytg verify --json` passed after the stack was reachable.

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Shared Docker image activates pinned pnpm before dependency installation. | `infra/Dockerfile.app`, refreshed 0.4.14 release proof |
| pnpm activation tolerates transient registry/network failures with bounded retries. | `infra/Dockerfile.app` retry loop |
| Image keeps `pnpm@10.0.0` and `pnpm install --frozen-lockfile`. | `package.json`, `infra/Dockerfile.app`, refreshed 0.4.14 release proof |
| Fix is limited to Docker build reliability. | `git diff`, only production file changed is `infra/Dockerfile.app` |
| Targeted verification passes the prior failing point. | refreshed 0.4.14 release proof |
| Docker verification image is named `happytg`. | refreshed 0.4.14 release proof |
| Proof artifacts record command output and fresh verification. | `problems.md`, `verdict.json`, refreshed 0.4.14 release proof |

## Verification Summary

- Dockerfile/BuildKit proof passed.
- Full installer Compose startup command passed on retry.
- Compose services are running; API, Bot, Mini App, and Worker are healthy.
- HappyTG `doctor` and `verify` both pass.
- Task bundle validation passes.
- Unit/lint commands were not run because the only production edit is the Dockerfile. This is recorded in `raw/test-unit.txt`, `raw/test-integration.txt`, and `raw/lint.txt`.

## Release Cleanup

Raw Docker logs from this earlier task are intentionally omitted from the 0.4.14 release branch because they contain environment-shaped compose/diagnostic material. The 0.4.14 release proof bundle records refreshed publish-safe verification for the release candidate.
