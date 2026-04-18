# Evidence

## Change

Interactive port-preflight resolution now updates the existing `Resolve planned ports` progress step immediately after the user confirms a new port. The detail text explicitly says that the installer is:

- saving the selected `HAPPYTG_*_PORT` override into the repo `.env`;
- re-running planned-port preflight before continuing.

This keeps the user on the standard progress surface instead of leaving the last visible screen on the stale `Port Conflict` prompt.

## Files

- `packages/bootstrap/src/install/index.ts`
- `packages/bootstrap/src/install.runtime.test.ts`

## Verification

- `pnpm --filter @happytg/bootstrap run build`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run lint`
- `pnpm --filter @happytg/bootstrap exec tsx --test --test-name-pattern "port preflight|progress while saving|promptSelect|promptPortValue|waitForEnter" src/install.test.ts src/install.runtime.test.ts`
- `pnpm --filter @happytg/bootstrap run test`

## Result

All commands passed. The new runtime regression test blocks the second `setup` run and proves that the progress screen visibly shows the in-flight save/rerun message before the installer reaches `Final Summary`.
