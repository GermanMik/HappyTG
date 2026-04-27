# Evidence

## Build/Fix Summary

- `packages/bootstrap/src/install/index.ts` now treats shared-infra host ports as Docker publish bindings when `launchMode === "docker"`.
- If Redis/PostgreSQL/MinIO default host ports are already occupied, the installer saves the suggested free `HAPPYTG_*` port override in `.env` before `docker compose up`.
- `packages/bootstrap/src/install/launch.ts` now passes repo `.env` values over the original process environment to Docker commands, so saved overrides cannot be shadowed by stale shell variables.
- `packages/bootstrap/src/install.runtime.test.ts` adds a regression covering occupied default infra ports and proves Compose receives remapped env values before startup.

## Verification

- Passed: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "docker"`
  - Raw log: `.agent/tasks/HTG-2026-04-28-docker-infra-port-remap/raw/test-runtime-docker.txt`
- Passed: `pnpm --filter @happytg/bootstrap run typecheck`
  - Raw log: `.agent/tasks/HTG-2026-04-28-docker-infra-port-remap/raw/typecheck-bootstrap.txt`
- Passed: `pnpm --filter @happytg/bootstrap run test`
  - Raw log: `.agent/tasks/HTG-2026-04-28-docker-infra-port-remap/raw/test-bootstrap.txt`
- Passed: `pnpm --filter @happytg/bootstrap run build`
  - Raw log: `.agent/tasks/HTG-2026-04-28-docker-infra-port-remap/raw/build-bootstrap.txt`
