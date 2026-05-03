# Evidence

## Initial State

- Branch: `codex/happytg-api-startup-test-stabilize`
- Release workflow run `25278110721`: failed
- Failing command in workflow: `pnpm test`
- Failing package/test: `@happytg/api#test`, `startApiServer retries a transient HappyTG API handoff before classifying reuse`

## Diagnosis

The test used a timer to close the occupied test server during the reuse probe window. In CI, the timing could leave the old HappyTG API mock visible until the final reuse classification, making `startApiServer` correctly return `{ status: "reused", port }` for that timing instead of the intended handoff path.

## Verification

- `raw/test-api.txt`: `pnpm --filter @happytg/api test` passed.
- `raw/test.txt`: initial full `pnpm test` passed.
- `raw/lint.txt`: `pnpm lint` passed.
- `raw/typecheck.txt`: `pnpm typecheck` passed.
- `raw/release-check.txt`: `pnpm release:check --version 0.4.11` passed.
- `raw/diff-check.txt`: `git diff --check` passed.
- `raw/build.txt`: `pnpm build` passed.
- `raw/test-unit.txt`: canonical `pnpm test` evidence passed.
- `raw/test-integration.txt`: canonical focused API test evidence passed.

## Minimal Fix

Only `apps/api/src/index.test.ts` changed. The transient handoff test no longer depends on a timer. It uses the existing `fetchImpl` injection to make the first reuse probe report a HappyTG API, closes the occupied mock server before returning that response, then makes later probes fail so `startApiServer` must bind the released port and return `{ status: "listening", port }`.

Production startup code was not changed.
