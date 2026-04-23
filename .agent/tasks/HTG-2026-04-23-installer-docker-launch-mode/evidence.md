# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed as a separate post-build pass
- `complete`: completed

## Commands Run

### Context and spec freeze

- `memory context --project`
- `memory search "HappyTG installer Docker Compose launch mode bootstrap install self-hosting host daemon"`
- `memory details 4edbc64f-031`
- proof bundle initialized under `.agent/tasks/HTG-2026-04-23-installer-docker-launch-mode/`
- frozen scope recorded in `spec.md` before production edits

### Builder verification

- `pnpm --filter @happytg/bootstrap run test` -> `raw/test-unit.txt`
- `pnpm --filter @happytg/bootstrap run typecheck` -> `raw/typecheck.txt`
- `pnpm --filter @happytg/bootstrap run build` -> `raw/build.txt`
- `pnpm --filter @happytg/bootstrap run lint` -> `raw/lint.txt`
- `pnpm test` -> `raw/test-integration.txt`
- `pnpm typecheck` -> `raw/root-typecheck.txt`
- `pnpm build` -> `raw/root-build.txt`
- `pnpm lint` -> `raw/root-lint.txt`
- `pnpm happytg doctor --json` -> `raw/doctor-json.txt`
- `pnpm happytg verify --json` -> `raw/verify-json.txt`

### Controlled Docker Compose verification

- First runtime proof run used `docker compose -f infra/docker-compose.example.yml ...` without `--env-file .env` and captured the mismatch in:
  - `raw/docker-compose-config-without-env-file.txt`
  - `raw/docker-compose-up-without-env-file.txt`
  - `raw/docker-compose-ps-without-env-file.txt`
  - `raw/health-api-without-env-file.txt`
  - `raw/health-bot-without-env-file.txt`
  - `raw/health-miniapp-without-env-file.txt`
- Second runtime proof run used the fixed command form `docker compose --env-file .env -f infra/docker-compose.example.yml ...` and captured:
  - `raw/docker-compose-ports.txt`
  - `raw/docker-compose-config.txt`
  - `raw/docker-compose-up.txt`
  - `raw/docker-compose-ps.txt`
  - `raw/health-api.txt`
  - `raw/health-bot.txt`
  - `raw/health-miniapp.txt`
  - `raw/docker-compose-down.txt`

### Fresh verify pass

- read-only verifier summary -> `raw/fresh-verifier.txt`
- `pnpm happytg task validate --repo . --task HTG-2026-04-23-installer-docker-launch-mode` -> `raw/task-validate.txt`

## Runtime Findings That Changed the Implementation

- The first controlled Compose run proved that `docker compose -f infra/docker-compose.example.yml ...` did not apply root `.env` values to host-port interpolation. `raw/docker-compose-config-without-env-file.txt` still published default ports such as `4000`, while the same run injected the overridden `HAPPYTG_*_PORT` values only into container environments.
- The same pre-fix runtime evidence showed a concrete collision on MinIO because the effective published host port stayed `9000` instead of the generated high override. That failure is captured in `raw/docker-compose-up-without-env-file.txt`.
- The fix was to make installer and shim guidance call Compose through `--env-file .env`. Post-fix `raw/docker-compose-config.txt` shows `published: "63435"` / `63436` / `63437` / `63439` / `63440` / `63441` / `63442`, matching `raw/docker-compose-ports.txt`.

## Code Changes

- `packages/bootstrap/src/install/types.ts`
  - added first-class install launch types and `InstallResult.launch`
- `packages/bootstrap/src/install/launch.ts`
  - added Docker launch executor, command/result modeling, readiness checks, finalization items, and explicit Compose command strings
  - switched Compose validation/start/status commands to `docker compose --env-file .env -f infra/docker-compose.example.yml ...`
- `packages/bootstrap/src/install/tui.ts`
  - added launch-mode screen
- `packages/bootstrap/src/install/index.ts`
  - threaded launch-mode through draft state, interactive flow, non-interactive flow, launch step reporting, and finalization
  - runs Docker launch only after `.env` merge and port preflight
- `packages/bootstrap/src/cli.ts`
  - added `--launch-mode local|docker|manual|skip`
- `packages/bootstrap/src/index.ts`
  - kept bootstrap/shared-infra guidance consistent with the new Compose command form and `.env`-driven port overrides
- `infra/docker-compose.example.yml`
  - publishes the bot host port for deterministic host readiness checks
- tests:
  - `packages/bootstrap/src/cli.test.ts`
  - `packages/bootstrap/src/install.test.ts`
  - `packages/bootstrap/src/install.runtime.test.ts`
  - `packages/bootstrap/src/infra-config.test.ts`
- docs:
  - `README.md`
  - `docs/installation.md`
  - `docs/self-hosting.md`
  - `docs/bootstrap-doctor.md`
  - `docs/quickstart.md`
  - `docs/troubleshooting.md`
  - `docs/operations/runbook.md`
  - `docs/engineering-blueprint.md`

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Installer UX exposes an explicit Docker Compose launch option. | `packages/bootstrap/src/install/types.ts`, `packages/bootstrap/src/install/tui.ts`, `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install.test.ts`, `raw/test-unit.txt` |
| Non-interactive installs can request Docker launch through a documented flag. | `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/cli.test.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `README.md`, `docs/installation.md`, `raw/test-unit.txt` |
| Docker is not required for local install or existing-service reuse. | `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install/launch.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `packages/bootstrap/src/index.ts`, `docs/installation.md`, `docs/self-hosting.md` |
| Compose startup never includes the host daemon. | `infra/docker-compose.example.yml`, `packages/bootstrap/src/install/launch.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `docs/self-hosting.md` |
| Final output separates Compose control-plane startup from host-daemon pairing/startup. | `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install/launch.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `README.md`, `docs/installation.md`, `docs/self-hosting.md` |
| Port conflict handling and Mini App port semantics are preserved. | `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `packages/bootstrap/src/infra-config.test.ts`, `infra/docker-compose.example.yml`, `raw/docker-compose-config.txt`, `raw/docker-compose-config-without-env-file.txt` |
| Verification passes and a fresh verifier pass confirms the task. | `raw/test-unit.txt`, `raw/typecheck.txt`, `raw/build.txt`, `raw/lint.txt`, `raw/test-integration.txt`, `raw/root-typecheck.txt`, `raw/root-build.txt`, `raw/root-lint.txt`, `raw/fresh-verifier.txt`, `raw/task-validate.txt`, `verdict.json` |
| Docs explain `pnpm dev`, Docker Compose, and manual startup choices. | `README.md`, `docs/installation.md`, `docs/self-hosting.md`, `docs/bootstrap-doctor.md`, `docs/quickstart.md`, `docs/troubleshooting.md` |

## Verification Summary

- Scoped bootstrap checks all passed: tests, typecheck, build, lint.
- Fresh repo-wide `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm lint` all passed after the final Compose command fix.
- `pnpm happytg doctor --json` and `pnpm happytg verify --json` still report builder-machine environment issues unrelated to this installer change:
  - missing `.env`
  - missing `TELEGRAM_BOT_TOKEN`
  - pre-existing locally running HappyTG services
  - existing Codex websocket `403 Forbidden` fallback-to-HTTP warning
- Controlled Docker Compose verification now proves `.env` host-port overrides are actually applied after the `--env-file .env` fix.
- Controlled Docker Compose verification still shows an unhealthy stack under the sanitized local test environment (`raw/docker-compose-ps.txt`, `raw/health-api.txt`, `raw/health-bot.txt`, `raw/health-miniapp.txt`), which is acceptable for this task because the installer is required to classify build/daemon/port/health failures as recoverable outcomes with actionable next steps.

## Fresh Verify Outcome

- The fresh verifier pass reviewed the frozen spec, the final diff, the updated proof bundle, and the required raw artifacts without editing production code.
- No scoped production-code findings remain.
- `raw/task-validate.txt` records the final repository validator result with `Phase: complete` and `Verification: passed`.
