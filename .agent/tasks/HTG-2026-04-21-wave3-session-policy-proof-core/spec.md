# Task Spec

- Task ID: HTG-2026-04-21-wave3-session-policy-proof-core
- Title: Wave 3 session policy proof core
- Owner: HappyTG
- Mode: proof
- Status: initialized

## Problem

HappyTG now has canonical states, bot-first projections, approvals, and proof bundles, but state transitions are still mostly ad hoc in the API and worker. Wave 3 must add the operational core that makes sessions resumable and auditable: a reducer/state machine, clearer approval resolution semantics, tool execution classification, serialized mutation planning, and proof-loop helpers for phase and stale verification handling.

This wave must evolve the existing TypeScript monorepo. It may add a new bounded `packages/session-engine` package because no equivalent module exists, but it must not replace the API, worker, daemon, approval engine, policy engine, or repo-proof package.

## Acceptance Criteria

1. Session reducer enforces valid transitions and rejects illegal transitions
2. Approval engine supports nonce-aware scoped idempotent resolution and expiry
3. Policy and tool execution model classify actions and serialize mutations
4. Repo proof lifecycle supports phase advance, approval references, and stale verification after mutation
5. API/session resume paths use the reducer without breaking existing daemon flows

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Keep Telegram callbacks from Wave 2 compatible.
- Keep host daemon pairing, heartbeat, dispatch polling, and proof-loop calls compatible.
- Treat `.agent/tasks/<TASK_ID>/state.json` as canonical proof state while preserving `task.json`.
- Out of scope: database migrations, NATS/Redis queue implementation, Mini App rich UI, and full security/token hardening. Those are later waves.

## Verification Plan

- Unit: session transition tests, approval nonce/idempotency tests, policy/tool planning tests, proof lifecycle tests, API resume/approval tests.
- Integration: run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Bundle: run `pnpm happytg task validate --repo . --task HTG-2026-04-21-wave3-session-policy-proof-core --json`.
