# Evidence

## Root Cause

Installer finalization only read `{ hostId }` from local daemon state and treated any existing host ID as a generic reuse/manual-handoff path. That collapsed two different product states:

- already paired or active host: should stay on reuse and never emit a fresh code;
- existing but still registering/unpaired host: should safely auto-refresh the pairing code during install.

Because `buildInstallFinalizationItems()` had no backend probe, the second case always degraded into manual `pnpm daemon:pair`, even though the real security boundary still lives in Telegram `/pair` claim handling.

## Architecture Decision

True zero-touch pairing is still not possible in the current architecture without changing the auth/security model, because the claim step remains intentionally bound to Telegram `/pair <CODE>`.

The implemented decision is maximum safe automation:

- no local host state: auto-request pairing code during install;
- existing local host plus backend `active`/`paired`: honest reuse, no fresh code;
- existing local host plus backend `registering`/refresh-needed: auto-refresh code and render explicit `/pair CODE` handoff;
- invalid Telegram token or blocked pairing prerequisites: keep blocked actionable diagnostics;
- existing host plus backend probe unavailable: keep honest manual fallback without pretending install completed pairing.

## Files

- `packages/bootstrap/src/install/index.ts`
- `packages/bootstrap/src/install/pairing.ts`
- `packages/bootstrap/src/install.runtime.test.ts`

## Verification

- `pnpm --filter @happytg/bootstrap run build`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run lint`
- `pnpm --filter @happytg/bootstrap exec tsx --test --test-name-pattern "auto-requests a pairing code|refreshes the pairing code automatically|reuses an already paired existing host|keeps pairing blocked|probe is unavailable" src/install.runtime.test.ts`
- `pnpm --filter @happytg/bootstrap run test`

## Result

The installer now uses an explicit pairing state machine instead of the old hostId-only heuristic:

- `blocked-telegram`
- `auto-request-new-host`
- `probe-existing-host`
- `reuse-existing-host`
- `refresh-existing-host`
- `manual-fallback`

Fresh verification passed after one minimal follow-up fix to suppress contradictory daemon-start guidance on blocked pairing paths. Independent verifier review then cleared the task with no remaining scoped findings.
