# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed with independent `task-verifier` pass
- `finish/publish`: pending

## Commands Run

### Baseline reproduction

- `pnpm happytg setup --json` -> `raw/setup-json.txt`
- `pnpm happytg doctor --json` -> `raw/doctor-json.txt`
- `pnpm happytg verify --json` -> `raw/verify-json.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-unit.txt`

### Targeted red/green regression runs

- `pnpm --filter @happytg/shared test`
- `pnpm --filter @happytg/runtime-adapters test` -> `raw/test-runtime-adapters-after-stdin-fix.txt`
- `pnpm --filter @happytg/bootstrap test` -> `raw/test-bootstrap-after-verifier-fix.txt`

### Post-fix real-machine verification

- `pnpm happytg setup --json` -> `raw/setup-json-final.txt`
- `pnpm happytg doctor --json` -> `raw/doctor-json-final.txt`
- `pnpm happytg verify --json` -> `raw/verify-json-final.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-unit.txt`

### Fresh verifier pass

- Independent verifier role: `task-verifier`
- Verifier agent: `019d99de-3c8c-7c33-bf2b-efc0f25cfa71` (`Epicurus`)
- Verifier reran:
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm happytg setup --json`
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-17-installer-diagnostics-proof-loop`
- Verifier result:
  - initial finding: stale proof bundle and superseded safe-port values in evidence only
  - final result after bundle sync: no remaining scoped findings

## Baseline Reproduction Summary

### Observed baseline warnings

- `CODEX_PATH_PENDING` repeated across setup/doctor/verify even though the npm wrapper executed successfully.
- `CODEX_SMOKE_FAILED` reported a contradictory state.
- `MINIAPP_PORT_BUSY`, `POSTGRES_PORT_BUSY`, `MINIO-API_PORT_BUSY`, and `MINIO-CONSOLE_PORT_BUSY` were all reported as generic busy ports.
- Final summary claimed `Ports: 3001 busy, 6379 busy; others free`, contradicting separate warnings for `5432`, `9000`, and `9001`.
- Telegram network warning collapsed to the generic `fetch failed` path.

### Machine-level attribution used during investigation

- `docker ps` showed:
  - `contacts-frontend` publishing `3001`
  - `shared-redis` publishing `6379`
  - `contacts-postgres` publishing `5432`
  - `nportal-minio-1` publishing `9000-9001`
- Direct HTTP probing confirmed:
  - `3001` served a `Contacts` frontend
  - `9000` and `9001` matched MinIO / MinIO Console
- Direct `codex.cmd exec --skip-git-repo-check --json "Print exactly OK and exit."` returned `OK`, proving the original smoke failure was not simply "Codex broken".

## Root Cause Analysis

### Telegram diagnostics

- Classification: product diagnostic weakness
- Root cause: recoverable network failures from `fetch()` were normalized into a generic `fetch failed` message, losing DNS / timeout / TLS / proxy / socket context.
- Fix: added explicit error-code/message classification plus clearer HTTP / non-JSON / network wording in `packages/bootstrap/src/install/telegram.ts`.

### Codex PATH / wrapper diagnostics

- Classification: partly legitimate environment warning, partly product bug
- Root cause 1: Windows executable resolution preferred a bare shim before `.cmd`, causing wrapper/path detection inconsistencies.
- Root cause 2: setup/doctor/verify warned repeatedly about PATH even when child-process execution already self-healed through the npm wrapper.
- Fix: prefer Windows executable companions in `packages/shared/src/index.ts`; keep wrapper execution working but reduce PATH noise to a single truthful warning when it actually applies.
- Post-fix on this machine: `pathPending=false`, so the PATH warning is gone entirely.

### Codex smoke diagnostics

- Classification: real product bug plus diagnostic bug
- Root cause 1: Windows `.cmd` wrapper invocation split the spaced smoke prompt incorrectly, producing the earlier `unexpected argument 'exactly' found`.
- Root cause 2: non-interactive child-process execution kept stdin open, which could make `codex exec` wait for EOF and then time out.
- Root cause 3: stderr classification treated benign internal Codex warnings as actionable and summarized the wrong line first.
- Fixes:
  - preserve spaced prompts for `.cmd` wrappers
  - close stdin for non-interactive child processes via `stdio: ["ignore","pipe","pipe"]`
  - improve benign-warning filtering and stderr summarization
- Post-fix on this machine: `smokeOk=true`, `smokeTimedOut=false`; the remaining warning is now a legitimate environment/network warning about `Responses websocket 403 Forbidden`.

### Port diagnostics and planned ports analysis

- Classification: product bug / false-positive diagnostics
- Root cause 1: port checks only treated ports as generic busy/free and lacked attribution.
- Root cause 2: local Postgres / MinIO / Redis reuse was not distinguished from third-party conflicts.
- Root cause 3: final summary used a narrower port subset than the actual warning list, producing contradictions.
- Root cause 4: the first alternative-port pass used naive sibling ports, which could collide with other planned HappyTG ports.
- Fixes:
  - derive the full current planned-port set from config
  - probe listeners and classify each planned port as `free`, `occupied_supported`, `occupied_expected`, or `occupied_external`
  - add Docker-based attribution when available
  - generate per-port alternatives from a blocked set of all planned ports plus already-assigned suggestions
  - summarize planned ports as `conflicts / reuse / free` without contradiction

## Code Changes

- `packages/shared/src/index.ts`
  - prefer Windows wrapper companions (`.cmd`, `.exe`, etc.) over bare shim files
- `packages/runtime-adapters/src/index.ts`
  - preserve spaced prompts through Windows wrappers
  - close stdin for non-interactive smoke/version commands
  - add `smokeTimedOut`
  - improve benign stderr filtering and smoke summary selection
- `packages/bootstrap/src/index.ts`
  - improve Codex smoke wording and final classification
  - add proactive planned-port analysis and reuse/conflict summary
  - attribute listeners via Docker / protocol probes
  - make override examples reflect the actual planned ports
  - compute safe suggested ports without colliding with other planned HappyTG ports
- `packages/bootstrap/src/install/telegram.ts`
  - richer Telegram network / HTTP / unexpected-response diagnostics
- `packages/bootstrap/src/install/commands.ts`
  - close stdin for non-interactive child commands

## Regression Coverage Added

- `packages/shared/src/index.test.ts`
  - Windows executable resolution prefers wrapper companions
- `packages/runtime-adapters/src/index.test.ts`
  - Windows `.cmd` smoke prompt with spaces remains intact
  - smoke runs do not hang waiting for stdin EOF
  - Codex stderr classifier ignores known benign internal warnings
  - smoke summary prefers actionable root-cause text
- `packages/bootstrap/src/index.test.ts`
  - doctor stays green through Windows wrapper smoke prompt
  - setup classifies compatible Redis/Postgres/MinIO listeners as supported reuse while flagging unrelated conflicts
  - safe port suggestions do not collide with planned ports or with each other
- `packages/bootstrap/src/install.test.ts`
  - Telegram DNS-style failures and non-JSON responses get precise diagnostics

## Post-Fix Real-Machine Result

### setup / doctor / verify final warnings

- `CODEX_SMOKE_WARNINGS`
  - now: `Codex CLI completed the smoke check with warnings: Codex could not open the Responses websocket (403 Forbidden).`
  - classification: legitimate environment warning on this machine; smoke itself now completes successfully
- `MINIAPP_PORT_BUSY`
  - now points to `contacts-frontend` on `3001` with a concrete alternative: `$env:HAPPYTG_MINIAPP_PORT="3006"; pnpm dev:miniapp`
  - classification: real local conflict

### Warnings removed or reclassified

- `CODEX_PATH_PENDING`
  - removed on this machine after correct wrapper resolution / self-healed execution path
- `CODEX_SMOKE_FAILED`
  - removed; smoke now passes and only surfaces truthful warnings
- `POSTGRES_PORT_BUSY`, `MINIO-API_PORT_BUSY`, `MINIO-CONSOLE_PORT_BUSY`
  - removed as conflicts; now classified as supported reuse

## Planned Ports Matrix

| Planned component | Port | Current listener | Classification | Suggested override |
| --- | ---: | --- | --- | --- |
| Mini App | 3001 | HTTP listener `Contacts` via Docker container `contacts-frontend` | Real conflict (`occupied_external`) | `$env:HAPPYTG_MINIAPP_PORT="3006"; pnpm dev:miniapp` |
| API | 4000 | free | Free | `$env:HAPPYTG_API_PORT="4001"; pnpm dev:api` |
| Bot | 4100 | free | Free | `$env:HAPPYTG_BOT_PORT="4101"; pnpm dev:bot` |
| Worker probe | 4200 | free | Free | `$env:HAPPYTG_WORKER_PORT="4201"; pnpm dev:worker` |
| Redis host port | 6379 | Redis via Docker container `shared-redis` (`redis:7-alpine`) | Supported reuse (`occupied_supported`) | `$env:HAPPYTG_REDIS_HOST_PORT="6380"; docker compose -f infra/docker-compose.example.yml up redis` |
| Postgres host port | 5432 | PostgreSQL via Docker container `contacts-postgres` (`postgres:16`) | Supported reuse (`occupied_supported`) | `$env:HAPPYTG_POSTGRES_HOST_PORT="5433"; docker compose -f infra/docker-compose.example.yml up postgres` |
| MinIO API host port | 9000 | MinIO via Docker container `nportal-minio-1` | Supported reuse (`occupied_supported`) | `$env:HAPPYTG_MINIO_PORT="9002"; docker compose -f infra/docker-compose.example.yml up minio` |
| MinIO console host port | 9001 | MinIO Console via Docker container `nportal-minio-1` | Supported reuse (`occupied_supported`) | `$env:HAPPYTG_MINIO_CONSOLE_PORT="9003"; docker compose -f infra/docker-compose.example.yml up minio` |

## Acceptance Mapping

- AC1 Telegram diagnostics: satisfied by `packages/bootstrap/src/install/telegram.ts` changes and `packages/bootstrap/src/install.test.ts`.
- AC2 Codex wrapper / PATH / smoke-check: satisfied by `packages/shared/src/index.ts`, `packages/runtime-adapters/src/index.ts`, `packages/bootstrap/src/index.ts`, and final `setup/doctor/verify` JSON artifacts.
- AC3 Ports: satisfied by `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, and final planned-port output.
- AC4 Planned ports analysis: satisfied by the new `plannedPorts` report data plus final-machine outputs.
- AC5 Final summary quality: satisfied by post-fix `preflight` and deduplicated `findings`.
- AC6 Regression coverage: satisfied by targeted test additions plus full `pnpm test`.
- AC7 Publish flow: pending publish steps; fresh verifier gate is now satisfied.
