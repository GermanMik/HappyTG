# Evidence

## Diagnosis

- EchoVault showed `0.4.23` raised the normal Mini App Codex fetch timeout to `6000ms`, with pagination/search left as follow-up if latency approached that budget.
- EchoVault showed `0.4.25` widened project-filtered Desktop session views to `limit=100`, but the `limit=100` path still used the normal `6000ms` timeout.
- Live local timings after `0.4.25` showed `limit=100` around `4.8s`, `limit=150` around `6.7s`, and `limit=200` around `8.1s`, leaving little margin for public/cold route latency.

## Change

- Added `effectiveCodexFetchTimeoutMs()` and `desktopSessionsFetchTimeoutMs(limit)`.
- Kept the default `limit=50` path on the configured/default timeout.
- Gave Desktop session fetches with `limit >= 100` a scoped minimum `10000ms` timeout.
- Added a regression test where global timeout is `10ms`, but a slow project-filtered `limit=100` Desktop fetch must still render sessions instead of a timeout warning.
- Bumped workspace release metadata to `0.4.26`.

## Validation

- `pnpm --filter @happytg/miniapp test` passed with 25 tests.
- `pnpm --filter @happytg/miniapp typecheck` passed.
- `pnpm --filter @happytg/miniapp lint` passed.
- `pnpm --filter @happytg/miniapp build` passed.
- `pnpm release:check --version 0.4.26` passed.
- `git diff --check` passed.
- Docker Mini App was rebuilt.
- Live Docker smoke passed: project default route returned HTTP 200, `71 visible`, and no `Desktop sessions unavailable` or `request timed out after 6000ms`; `limit=200` returned HTTP 200, `159 visible`, and no timeout warning.

Raw outputs are stored in `raw/`.
