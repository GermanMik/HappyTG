# Installer Docker Caddy Port 80 Repair Prompt

Use this prompt when `pnpm happytg install` reaches "Launch control-plane stack" in Docker Compose mode, builds images successfully, creates/starts most containers, and then fails because the Compose Caddy service cannot bind host port `80`.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Create or switch to a dedicated repair branch before changing production code:

```powershell
git switch -c codex/installer-docker-caddy-port80-repair
```

If the branch already exists, switch to it without discarding local user changes. Do not use `git reset --hard`, `git checkout --`, or any destructive cleanup unless the user explicitly asks.

## Current Failure

The installer run completed dependency checks, saved Docker infra port overrides, connected the Telegram bot, configured the Windows Scheduled Task, and then failed at Docker Compose startup:

```text
x Launch control-plane stack
   Docker Compose startup failed.
   Command: `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d`.

Error response from daemon: failed to set up container networking:
driver failed programming external connectivity on endpoint infra-caddy-1 ...
Bind for 0.0.0.0:80 failed: port is already allocated
```

Important surrounding evidence:

- Planned port preflight reported only these planned ports as clear or remapped: Mini App `3007`, API `4000`, Bot `4100`, Worker probe `4200`, Redis `6380`, Postgres `5433`, MinIO API `9002`, MinIO console `9006`.
- The Compose file also publishes Caddy `HAPPYTG_HTTP_PORT:-80`, Caddy `HAPPYTG_HTTPS_PORT:-443`, Prometheus `HAPPYTG_PROMETHEUS_PORT:-9090`, and Grafana `HAPPYTG_GRAFANA_PORT:-3000`.
- The failed run proves Caddy host port `80` was not protected by the same planned-port preflight/remap flow.
- The post-run diagnostics also warned that the public Caddy Mini App route returned HTTP 200 but did not contain the HappyTG Mini App identity. Treat that as likely fallout from another service already owning port `80`, not proof that HappyTG Caddy is serving the wrong app.
- The post-run diagnostics warned that `infra-minio-1` already occupied the planned MinIO remap ports. Treat this as a possible partial Compose-start artifact from the same failed install before calling it an external conflict.
- Codex CLI websocket `403 Forbidden` warnings are not the primary launch blocker for this task. Keep them out of scope unless they mask required verification.

## Mandatory Startup Discipline

Follow repository instructions exactly:

1. Retrieve EchoVault context first:
   - `memory context --project`
   - `memory search "HappyTG installer docker compose caddy port 80 planned port preflight"`
   - fetch details for relevant memories, especially Docker launch port-remap memories.
2. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` before production edits:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `task.json`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
3. Freeze scope in `spec.md` before build.
4. Keep builder and verifier roles separate. The verifier must not edit production code.
5. Use minimal fixes only. Do not rewrite installer architecture or Docker topology unless evidence proves it is necessary.

Recommended task id: `HTG-2026-04-28-installer-docker-caddy-port80`.

## Goal

Make Docker Compose launch mode resilient when host ports `80` and/or `443` are already occupied, with truthful installer output and without weakening the public Caddy contract.

The finished repair must:

1. preflight every host port that `infra/docker-compose.example.yml up --build -d` may publish by default;
2. offer/save explicit `.env` overrides for Caddy HTTP/HTTPS conflicts before Compose startup, the same way Redis/Postgres/MinIO conflicts are handled;
3. avoid misclassifying a HappyTG-owned partial Compose container as an unsupported external port conflict;
4. keep Telegram menu/Caddy route diagnostics truthful after Caddy failed to start;
5. preserve existing local-dev reuse behavior for supported local Redis/PostgreSQL/S3 services;
6. keep host daemon startup outside Docker Compose.

## Required Investigation Scope

Inspect and test these areas:

- Compose host port declarations:
  - `infra/docker-compose.example.yml`
  - `HAPPYTG_HTTP_PORT`
  - `HAPPYTG_HTTPS_PORT`
  - `HAPPYTG_PROMETHEUS_PORT`
  - `HAPPYTG_GRAFANA_PORT`
  - already-covered `HAPPYTG_*_PORT` values for API, Bot, Worker probe, Mini App, Redis, Postgres, and MinIO
- Installer planned-port preflight:
  - `packages/bootstrap/src/install/index.ts`
  - `packages/bootstrap/src/install/launch.ts`
  - setup/doctor port findings that feed the install flow
- Existing Docker port remap tests:
  - `packages/bootstrap/src/install.runtime.test.ts`
  - `packages/bootstrap/src/install.scripts.test.ts`
  - any bootstrap setup/doctor tests that assert port conflict reporting
- Caddy route and Telegram menu diagnostics:
  - `packages/bootstrap/src/telegram-menu.ts`
  - installer finalization/report rendering
  - docs that tell users to run `pnpm happytg telegram menu set`

## Explicit Questions To Answer

Your evidence must answer:

1. Which code builds the planned port list shown by "Resolve planned ports"?
2. Why were Caddy `80`/`443`, Prometheus `9090`, and Grafana `3000` absent from the clear/remap summary?
3. Does the existing preflight model support adding these ports cleanly, or is a separate Compose-published-port preflight needed?
4. When a previous failed Compose run leaves `infra-minio-1` running, how does HappyTG distinguish "current project container already started" from "external unsupported service owns the port"?
5. Should installer launch continue if only Caddy public ports are remapped, and how should the final guidance show the effective public HTTP/HTTPS ports?
6. How should `pnpm happytg telegram menu set` guidance change when Caddy is remapped to a non-default HTTP/HTTPS host port?

## Expected Fix Shape

Prefer a small, auditable repair:

- Extend planned-port preflight coverage so Docker launch mode checks all Compose-published host ports before `docker compose up --build -d`.
- Add Caddy HTTP and HTTPS port entries with env overrides:
  - `HAPPYTG_HTTP_PORT`, default `80`
  - `HAPPYTG_HTTPS_PORT`, default `443`
- Strongly consider adding Prometheus and Grafana entries because the same Compose command publishes them:
  - `HAPPYTG_PROMETHEUS_PORT`, default `9090`
  - `HAPPYTG_GRAFANA_PORT`, default `3000`
- Keep the installer's "Free:" and "Saved overrides:" summary complete and explicit.
- If setup/doctor identifies a listener as the HappyTG Compose project started by the same run, report it as reuse/current-stack state, not as an unsupported conflict.
- If Caddy is remapped away from public `80`/`443`, make final guidance explicit that Telegram Web App public URLs still require public HTTPS; a local remap fixes container startup but does not by itself make Telegram production routing valid.
- Improve the launch failure detail for bind errors so the failing port and override env var are obvious, for example: `port 80 is occupied; set HAPPYTG_HTTP_PORT=8080 or free the listener`.

Do not remove Caddy from the packaged Compose stack. Do not silently skip Caddy after a bind failure. Do not treat an arbitrary service on port `80` as a valid HappyTG Caddy route.

## Suggested Tests

Add focused regression coverage before broad repo checks:

- Interactive Docker launch preflight detects `HAPPYTG_HTTP_PORT` default `80` as occupied, offers nearby free ports, saves the selected override to `.env`, reruns preflight, and passes the saved value to Docker launch.
- The same behavior works for `HAPPYTG_HTTPS_PORT` default `443`.
- If implemented, equivalent coverage exists for `HAPPYTG_PROMETHEUS_PORT` and `HAPPYTG_GRAFANA_PORT`.
- Docker launch failure text for a bind error includes the failed port and a concrete override hint.
- Existing Docker infra remap tests still pass for Redis/Postgres/MinIO.
- Diagnostics do not claim the public Caddy Mini App route is healthy when Caddy failed to start and another service answered HTTP 200.
- Partial Compose-start containers belonging to the same HappyTG project do not produce misleading "unsupported reuse" MinIO warnings.

## Recommended Evidence To Capture

Store outputs in `.agent/tasks/<TASK_ID>/raw/`:

- `init-memory.txt`
- `git-status-before.txt`
- `compose-published-ports.txt`
- `port-preflight-analysis.txt`
- `repro-port80-conflict.txt`
- `partial-compose-state.txt`
- `test-unit.txt`
- `test-integration.txt`
- `typecheck.txt`
- `build.txt`
- `lint.txt`
- `doctor-json.txt`
- `verify.txt`
- `task-validate.txt`
- `fresh-verifier.txt`

Sanitize tokens, bot usernames only if needed, public URLs if they reveal private infrastructure, and any credentials in `.env`.

## Verification Requirements

At minimum run and record:

```powershell
pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Docker|port|launch|preflight|Caddy"
pnpm --filter @happytg/bootstrap exec tsx --test src/install.scripts.test.ts
pnpm --filter @happytg/bootstrap run typecheck
pnpm --filter @happytg/bootstrap run build
pnpm --filter @happytg/bootstrap run lint
pnpm happytg task validate --repo . --task HTG-2026-04-28-installer-docker-caddy-port80
```

If the fix changes shared setup/doctor port detection, Telegram menu diagnostics, docs, or Compose files, also run the relevant expanded checks:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm happytg doctor --json
pnpm happytg verify
```

For runtime proof, use a controlled local conflict on a disposable port where possible. If testing real port `80` requires elevated permissions or risks disrupting a local service, document the constraint and prove the parser/preflight behavior with dependency-injected port probes plus a non-destructive Compose config check:

```powershell
docker compose --env-file .env -f infra/docker-compose.example.yml config
```

## Completion Criteria

Do not mark complete until the proof bundle demonstrates:

1. Docker launch preflight covers every default host port published by the full Compose stack, including Caddy.
2. Port `80` conflict no longer reaches Docker as a late bind failure in the normal installer flow.
3. Saved `.env` overrides are used by the exact Compose command that installer runs.
4. The final installer summary distinguishes local startup success from public Telegram/Caddy readiness.
5. MinIO partial-start warnings are either fixed or recorded as a separate proven follow-up with clear impact.
6. Required verification is green.
7. A fresh verifier pass confirms the repair without editing production code.
