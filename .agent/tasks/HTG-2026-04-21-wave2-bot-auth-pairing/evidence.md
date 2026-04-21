# Evidence Summary

## Acceptance Criteria Mapping

1. Bot main menu is wizard-first and command-light
   - Implemented in `apps/bot/src/handlers.ts`.
   - Covered by `apps/bot/src/handlers.test.ts` menu and wizard tests.

2. API exposes host/workspace/session/approval projections for bot flows
   - Implemented in `apps/api/src/service.ts` and `apps/api/src/index.ts`.
   - Covered by `apps/api/src/service.test.ts`.

3. Approval callbacks use scoped decisions and nonce-aware replay basics
   - `ResolveApprovalRequest` now accepts optional `scope` and `nonce`.
   - Bot callback data uses short `a:<scope-code>:<approvalId>:<nonce>` contracts.
   - API rejects mismatched callback nonce and preserves already-resolved approval protection.

4. Existing daemon pairing and heartbeat flow remains compatible
   - Host daemon payloads were not changed.
   - Existing daemon tests passed in full `pnpm test`.

5. Wave 2 proof evidence is recorded under `.agent/tasks`
   - This bundle contains frozen spec, evidence, raw build/lint/test logs, state, and verdict.

## Build Summary

Wave 2 extends the existing TypeScript HappyTG repository instead of creating a parallel architecture.

Implemented:

- API projections for bot flows:
  - `GET /api/v1/hosts/:id/workspaces?userId=...`
  - `GET /api/v1/sessions?userId=...`
  - `GET /api/v1/approvals?userId=...&state=...`
  - Mini App bootstrap overview now includes active workspaces.
- Approval resolution now accepts backward-compatible `scope` and `nonce`.
- Control plane checks host ownership before session/bootstrap dispatch.
- Bot handlers now render `/start` and `/menu` action-first main menu, `/task` wizard, `/sessions`, `/approve`, session cards, and scoped approval dialogs.
- Legacy `approval:approve:<id>` and `approval:reject:<id>` callbacks remain accepted.
- Bot-first UX contracts and message examples are documented in `docs/architecture/bot-first-ux.md`.

## Verification

- `pnpm --filter @happytg/bot test` passed.
- `pnpm --filter @happytg/api test` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm test` passed.
- `pnpm build` passed.

Raw logs are stored under `raw/`.
