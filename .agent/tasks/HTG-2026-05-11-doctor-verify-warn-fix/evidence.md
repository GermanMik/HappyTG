# Evidence

Task: `HTG-2026-05-11-doctor-verify-warn-fix`

## Spec Freeze

Scope frozen before code or environment repair work.

## Reproduction

- `raw/doctor-before.txt`: `pnpm happytg doctor` exited 0 with `[WARN]`.
  - Codex smoke succeeded, but stderr contained a Codex memory phase 403 diagnostic and was reported as `CODEX_SMOKE_WARNINGS`.
  - Public `/miniapp` returned HTTP 200 with HealthOS HTML, not HappyTG Mini App identity.
- `raw/verify-before.txt`: `pnpm happytg verify` exited 0 with the same two WARN findings.
- `raw/miniapp-local-body-before.html`: local upstream `http://127.0.0.1:3007/` returned `<title>HappyTG Mini App</title>`.
- `raw/miniapp-local-prefix-body-before.html`: local upstream `http://127.0.0.1:3007/miniapp` returned 404, confirming Caddy must strip `/miniapp`.

## Changes

- Updated `packages/runtime-adapters/src/index.ts` to classify successful-smoke benign Codex stderr as non-actionable for:
  - `codex_core::memories::phase1::job::result` 403 diagnostics.
  - `sqlx::query` slow PRAGMA SQLite diagnostics.
- Updated `packages/runtime-adapters/src/index.test.ts` to lock the classifier behavior while keeping an unknown `WARN custom warning` actionable.
- Repaired operator-owned `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile`:
  - restored `happytg_runtime`, `happytg.gerta.crazedns.ru`, and `happytg.gerta.crazedns.ru:8443`;
  - added `/miniapp*` and `/static*` route handling with stripped `/miniapp` prefix to `127.0.0.1:3007`;
  - added `:8443` HappyTG path overrides before HealthOS fallback;
  - set Mini App upstream `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-Prefix` headers so public edge Host/SNI collapse still renders the public HappyTG origin.
- `raw/basedeploy-caddy-happytg-snippet-after.txt` records the repaired Caddy snippet because `C:\Develop\Projects\BaseDeploy` is not a git repository.
- Reloaded local Caddy after validation.

## Verification

- `raw/test-unit.txt`: `pnpm --filter @happytg/runtime-adapters test` passed, 23/23 tests.
- `raw/lint.txt`: `pnpm --filter @happytg/runtime-adapters lint` passed.
- `raw/build.txt`: `pnpm --filter @happytg/runtime-adapters build` passed.
- `raw/lint-full.txt`: `pnpm lint` passed, 15/15 Turbo tasks.
- `raw/build-full.txt`: `pnpm build` passed, 15/15 Turbo tasks.
- `raw/test-full.txt`: `pnpm test` passed, 15/15 Turbo tasks.
- `raw/typecheck-full.txt`: `pnpm typecheck` passed, 15/15 Turbo tasks.
- `raw/release-check-0.4.15.txt`: `pnpm release:check --version 0.4.15` passed.
- `raw/caddy-validate-after-header-fix.txt`: BaseDeploy Caddyfile validated successfully.
- `raw/caddy-reload-after-header-fix.txt`: Caddy reload completed with exit 0.
- `raw/caddy-public-body-after.html`: public `https://happytg.gerta.crazedns.ru/miniapp` returned HappyTG Mini App identity and `window.HAPPYTgApiBase = ""`.
- `raw/caddy-public-healthos-health-body-after.txt`: public HealthOS health route still returned HealthOS API JSON.
- `raw/doctor-after.txt`: `pnpm happytg doctor` passed with no warnings.
- `raw/test-integration.txt`: `pnpm happytg verify` passed with no warnings.
- `raw/task-validate.txt`: proof bundle validation passed.

## Critical Role Review

1. Runtime adapter maintainer: classifier change is narrow and still leaves unknown stderr actionable.
2. Bootstrap verifier: `doctor` and `verify` both pass through the real CLI path, not only unit tests.
3. Caddy operator: source Caddyfile now matches the required HappyTG route; reload succeeded.
4. Mini App owner: public HTML identity and marker are present.
5. Browser API owner: public Mini App now renders `window.HAPPYTgApiBase = ""`, so browser calls stay same-origin.
6. HealthOS owner: HealthOS public API health still returns HealthOS JSON after the Caddy change.
7. Security reviewer: no tokens or private credentials were printed into final proof; API exposure remains limited to existing Mini App exceptions.
8. Windows operator: validation used Windows `curl.exe`, local Caddy binary, and PowerShell paths.
9. Release verifier: repo lint, typecheck, build, test, release metadata check, `doctor`, `verify`, and task validation all exit 0.
10. Scope reviewer: BaseDeploy is not a git repo; environment repair is recorded as proof evidence, while repo code changes remain isolated to the HappyTG branch.
