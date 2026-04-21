# Evidence Summary

## Acceptance Criteria Mapping

1. Session reducer enforces valid transitions and rejects illegal transitions
   - Added `packages/session-engine` with transition table, reducer replay, resume semantics, and tests.
   - API create/approval/ack/update/complete/resume paths now use reducer helpers.

2. Approval engine supports nonce-aware scoped idempotent resolution and expiry
   - Added `resolveApprovalRequestIdempotent`, nonce assertion, resolved/waiting helpers, and tests.
   - API approval replay no longer creates duplicate dispatches.

3. Policy and tool execution model classify actions and serialize mutations
   - Policy engine now filters policies by effective scope before deny/approval/allow evaluation.
   - Runtime adapters now classify action kinds into tool categories and plan read-parallel / mutation-serial batches.

4. Repo proof lifecycle supports phase advance, approval references, and stale verification after mutation
   - Added `readTaskBundleState`, `advanceTaskPhase`, `recordTaskApproval`, and `markVerificationStaleAfterMutation`.
   - Tests cover approval references and stale verification after a passed verifier state.

5. API/session resume paths use the reducer without breaking existing daemon flows
   - Existing API, daemon, worker, bot, miniapp, and bootstrap tests pass under full `pnpm test`.

## Files Changed

- `packages/session-engine/*`
- `packages/approval-engine/src/index.ts`
- `packages/approval-engine/src/index.test.ts`
- `packages/policy-engine/src/index.ts`
- `packages/policy-engine/src/index.test.ts`
- `packages/runtime-adapters/src/index.ts`
- `packages/runtime-adapters/src/index.test.ts`
- `packages/repo-proof/src/index.ts`
- `packages/repo-proof/src/index.test.ts`
- `apps/api/src/service.ts`
- `apps/api/src/service.test.ts`
- `tsconfig.base.json`
- `docs/architecture/session-policy-proof-core.md`

## Verification

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm test` passed.
- `pnpm build` passed.

Raw logs are stored under `raw/`.
