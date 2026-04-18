# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed with independent `task-verifier` rerun
- `complete`: completed

## Commands Run

### Baseline reproduction and attribution

- `pnpm dev` -> `raw/repro-pnpm-dev.txt`
- `curl http://127.0.0.1:3001/`, `docker inspect contacts-frontend`, and listener attribution commands -> `raw/port-3001.txt`
- `curl http://127.0.0.1:4000/ready` and listener attribution commands -> `raw/port-4000.txt`
- `docker ps`, BaseDeploy compose/Caddy inspection -> `raw/base-deploy-port-attribution.txt`
- `pnpm happytg setup --json` before the fix -> `raw/installer-port-check-before.txt`

### Post-fix machine verification

- `pnpm dev` -> `raw/repro-pnpm-dev-after.txt`
- `pnpm happytg setup --json` -> `raw/installer-port-check-after.txt`
- `HAPPYTG_MINIAPP_PORT=\"\" PORT=3005 pnpm happytg setup --json` -> `raw/installer-port-check-port-fallback.txt`
- `pnpm --filter @happytg/api test`
- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/bootstrap test`
- `pnpm build` -> `raw/build.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-integration.txt`

### Verification and proof-loop discipline

- Initial independent verifier pass: agent `019da0ac-d0e9-79a1-95ee-333f55253d86`
- Verifier surfaced two scoped findings:
  - bootstrap preflight claimed `HAPPYTG_*_PORT/PORT` guidance without honoring `PORT` as fallback in planned-port resolution
  - proof bundle files were still missing, so `task validate` could not complete
- Builder fix after verifier:
  - `packages/bootstrap/src/index.ts` now includes `PORT` in planned app port resolution for Mini App, API, Bot, and Worker probe
  - `packages/bootstrap/src/index.test.ts` now covers `PORT` fallback explicitly
  - proof bundle files were added and synchronized
- Fresh independent verifier rerun:
  - reran `pnpm --filter @happytg/api test`
  - reran `pnpm --filter @happytg/miniapp test`
  - reran `pnpm --filter @happytg/bootstrap test`
  - reran `pnpm happytg setup --json`
  - reran `pnpm happytg task validate --repo . --task HTG-2026-04-18-dev-miniapp-port-conflict-followup`
  - final scoped finding: bundle closure still lacked `task.json` / final proof-loop completion metadata
- Final closure fix:
  - added `task.json` with `phase=complete` and `verificationState=passed`
  - synchronized `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json` with the final verifier result

## Baseline Machine Facts

### Port `3001`

- `docker ps` and `docker inspect` show `contacts-frontend` publishing `0.0.0.0:3001->4173/tcp`.
- `curl http://127.0.0.1:3001/` returns HTML with `<title>Contacts</title>`.
- `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile` reverse proxies `contacts.gerta.crazedns.ru` to `http://localhost:3001`.
- Classification: foreign conflict for HappyTG Mini App, with BaseDeploy/Caddy pointing at the same listener. This is not a supported HappyTG reuse path.

### Port `4000`

- `curl http://127.0.0.1:4000/ready` returns HappyTG API JSON.
- `docker ps` shows `infra-api-1` publishing `0.0.0.0:4000->4000/tcp`.
- Classification: legitimate HappyTG API reuse path on this machine.

## Root Cause Analysis

### Why this is a product bug, not just a local environment issue

- The local environment facts were real:
  - `3001` was owned by `contacts-frontend` / Contacts, with BaseDeploy Caddy routing to it
  - `4000` was owned by a running HappyTG API
- The product bug was the classification and UX:
  - Mini App startup treated any occupied `3001` as a possible reuse path and told the operator to "reuse the running mini app if it is yours" even when the listener was clearly not HappyTG
  - The current branch had regressed API startup back to a raw `EADDRINUSE` failure path on `4000`, so startup and bootstrap were no longer consistent
  - Bootstrap already had richer port diagnostics, but its planned-port preflight did not fully honor `PORT` fallback for app services, so part of the operator guidance was not yet truthful

### Mini App vs API behavior

- The correct model is symmetric at the product level:
  - reuse only when the occupied port is proven to host the same HappyTG service
  - report a conflict when the port is occupied by another HappyTG service or by a foreign listener
- There is no architecture invariant requiring Mini App to be looser than API here.
- Both services now use the same decision shape:
  - probe for HappyTG service identity first
  - if same service, emit reuse guidance
  - if different service or foreign HTTP listener, emit conflict guidance with explicit overrides

## Code Changes

- `apps/api/src/index.ts`
  - restored product-level occupied-port handling instead of falling through to raw `EADDRINUSE`
  - added same-service reuse, different-service conflict, and transient handoff probing
- `apps/api/src/index.test.ts`
  - added regression tests for API reuse, foreign conflict, different HappyTG service conflict, and transient handoff
- `apps/miniapp/src/index.ts`
  - replaced generic occupied-port messaging with truthful classification
  - detect same-service Mini App reuse even when `/ready` is degraded but still identifies `service: "miniapp"`
  - name foreign HTTP listeners such as `Contacts`
- `apps/miniapp/src/index.test.ts`
  - added regression tests for foreign conflict, same-service reuse, different-service conflict, and named HTTP listeners
- `packages/bootstrap/src/index.ts`
  - kept product-level preflight as the installer/bootstrap source of truth for port classification
  - conflict wording now explicitly says conflict vs supported reuse
  - app planned-port preflight now honors `PORT` as fallback after service-specific env keys
- `packages/bootstrap/src/index.test.ts`
  - updated conflict wording assertions
  - added regression coverage for `PORT` fallback in planned app port resolution
- `docs/installation.md`
- `docs/quickstart.md`
- `docs/troubleshooting.md`
  - updated operator guidance to explain reuse vs conflict and explicit manual overrides

## Regression Coverage Added

- `apps/api/src/index.test.ts`
  - API occupied-port reuse/conflict classification
- `apps/miniapp/src/index.test.ts`
  - Mini App occupied-port reuse/conflict classification, including foreign HTML title attribution
- `packages/bootstrap/src/index.test.ts`
  - truthful setup conflict wording
  - `PORT` fallback when app-specific overrides are absent

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Mini App occupied-port path on `3001` is proven or fixed | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `raw/repro-pnpm-dev-after.txt`, `raw/port-3001.txt` |
| `3001` is correctly classified as conflict / BaseDeploy-linked listener | `raw/port-3001.txt`, `raw/base-deploy-port-attribution.txt`, `raw/installer-port-check-after.txt` |
| API `4000` reuse path remains intact | `apps/api/src/index.ts`, `apps/api/src/index.test.ts`, `raw/port-4000.txt`, `raw/repro-pnpm-dev-after.txt`, `raw/installer-port-check-after.txt` |
| Installer/bootstrap does truthful preflight before launch | `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `raw/installer-port-check-before.txt`, `raw/installer-port-check-after.txt` |
| Occupied-port UX names listener / reuse / conflict / overrides | `raw/installer-port-check-after.txt`, `raw/port-3001.txt`, `raw/port-4000.txt` |
| `PORT` fallback is honored without changing explicit env precedence | `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `raw/installer-port-check-port-fallback.txt` |
| No hidden auto-reassignment of defaults | `apps/api/src/index.ts`, `apps/miniapp/src/index.ts`, `packages/bootstrap/src/index.ts`, docs changes |
| Regression coverage exists for touched paths | `raw/test-unit.txt`, `raw/test-integration.txt` |
| Repo-wide verification still passes | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-integration.txt` |

## Residual Risk

- The one-line `pnpm dev` Mini App error now names a foreign HTTP listener (`Contacts`) but not the Docker container or BaseDeploy/Caddy hop. The richer attribution is currently strongest in bootstrap/setup preflight, not in the single runtime line.
- Codex smoke warnings (`Responses websocket 403 Forbidden`, fallback to HTTP) remain visible in setup output on this machine. They are unrelated to the port fix and should stay visible as legitimate environment noise.

## Final Verifier Outcome

- Independent verifier: agent `019da0ac-d0e9-79a1-95ee-333f55253d86`
- Result after bundle closure: no remaining scoped findings
- Fresh verifier confirmed:
  - Mini App `3001` remains an external conflict (`contacts-frontend` / Contacts)
  - API `4000` remains legitimate HappyTG reuse (`infra-api-1`)
  - bootstrap/setup conflict UX is truthful and deterministic for the investigated paths
  - `task validate` is green once task metadata is present
