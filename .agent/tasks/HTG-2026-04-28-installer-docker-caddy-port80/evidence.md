# Evidence

Status: complete.

## Investigation

- Compose publishes host ports for Postgres, Redis, MinIO API/console, API, Bot, Mini App, Caddy HTTP/HTTPS, Prometheus, and Grafana. Evidence: `raw/compose-published-ports.txt`.
- The installer step labelled "Resolve planned ports" calls `resolvePortConflictsBeforePostChecks()` in `packages/bootstrap/src/install/index.ts`; that reads setup reports from `runBootstrapCommand("setup")`.
- Setup/doctor builds planned ports from `criticalPortDefinitions` -> `plannedPortDefinitions()` -> `detectCriticalPorts()` in `packages/bootstrap/src/index.ts`, then emits both `reportJson.ports` and `reportJson.plannedPorts`.
- Caddy `80`/`443`, Prometheus `9090`, and Grafana `3000` were absent because `criticalPortDefinitions` only listed Mini App/API/Bot/Worker/Redis/Postgres/MinIO. The existing model supported adding them cleanly.

## Changes

- Added planned-port definitions for:
  - `HAPPYTG_HTTP_PORT` default `80`
  - `HAPPYTG_HTTPS_PORT` default `443`
  - `HAPPYTG_PROMETHEUS_PORT` default `9090`
  - `HAPPYTG_GRAFANA_PORT` default `3000`
- Extended Docker launch auto-remap to Caddy and observability host ports while preserving supported Redis/Postgres/MinIO remaps.
- Added Docker Compose label attribution so a current HappyTG Compose service publishing a port is treated as current-stack reuse instead of an unsupported external conflict.
- Improved bind-failure detail so `0.0.0.0:80` failures name `HAPPYTG_HTTP_PORT=8080`.
- Added final guidance when Caddy host ports are remapped: local startup may be fixed, but Telegram menu setup still needs a public HTTPS `/miniapp` URL, with an explicit non-default HTTPS port when used.

## Verification

- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Docker|port|launch|preflight|Caddy"`: pass, 52 tests. Evidence: `raw/test-unit.txt`.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.scripts.test.ts`: pass, 5 tests. Evidence: `raw/test-integration.txt`.
- `pnpm --filter @happytg/bootstrap run typecheck`: pass. Evidence: `raw/typecheck.txt`.
- `pnpm --filter @happytg/bootstrap run build`: pass. Evidence: `raw/build.txt`.
- `pnpm --filter @happytg/bootstrap run lint`: pass. Evidence: `raw/lint.txt`.
- `pnpm typecheck`: pass. Evidence: `raw/typecheck-root.txt`.
- `pnpm lint`: pass. Evidence: `raw/lint-root.txt`.
- `pnpm test`: pass, 15 tasks and bootstrap 124 tests. Evidence: `raw/test-root.txt`.
- `pnpm happytg doctor --json`: exit 0 with local warnings. Evidence: `raw/doctor-json.txt`.
- `pnpm happytg verify`: exit 0 with local warnings. Evidence: `raw/verify.txt`.
- Fresh verifier pass: static diff/port mapping review, `git diff --check`, and focused verifier tests for Caddy remap, bind hints, and legacy `infra-minio-1` current-stack attribution passed. Evidence: `raw/fresh-verifier.txt`.
- `pnpm happytg task validate --repo . --task HTG-2026-04-28-installer-docker-caddy-port80`: pass. Evidence: `raw/task-validate.txt`.

## Explicit Questions

1. Which code builds the planned port list shown by "Resolve planned ports"?
   `packages/bootstrap/src/install/index.ts` runs `resolvePortConflictsBeforePostChecks()`, which calls setup and reads `reportJson.ports/plannedPorts`. The list itself is built in `packages/bootstrap/src/index.ts` by `criticalPortDefinitions`, `plannedPortDefinitions()`, and `detectCriticalPorts()`.
2. Why were Caddy `80`/`443`, Prometheus `9090`, and Grafana `3000` absent from the clear/remap summary?
   They were not in `criticalPortDefinitions`, so setup never emitted planned-port reports for them.
3. Does the existing preflight model support adding these ports cleanly, or is a separate Compose-published-port preflight needed?
   The existing model is sufficient for this repair because each Compose-published host port maps to an env override and can be represented as a planned port.
4. When a previous failed Compose run leaves `infra-minio-1` running, how does HappyTG distinguish "current project container already started" from "external unsupported service owns the port"?
   Docker `ps` parsing now includes Compose labels. If the published port belongs to the expected service and the current repo `infra` Compose working directory, the port is `occupied_expected` current-stack state rather than an external conflict.
5. Should installer launch continue if only Caddy public ports are remapped, and how should the final guidance show the effective public HTTP/HTTPS ports?
   Yes, local Docker startup may continue after explicit `.env` overrides. The final guidance warns that this only fixes local binding; public Telegram readiness still requires a public HTTPS URL, with the non-default HTTPS port included when `HAPPYTG_HTTPS_PORT` was remapped.
6. How should `pnpm happytg telegram menu set` guidance change when Caddy is remapped to a non-default HTTP/HTTPS host port?
   It must not imply local remap equals public readiness. If HTTPS is remapped, `HAPPYTG_PUBLIC_URL` or `HAPPYTG_MINIAPP_URL` must include the explicit public HTTPS port before running `pnpm happytg telegram menu set`.
