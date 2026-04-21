# HappyTG Session, Policy, and Proof Core

Wave 3 introduces explicit operational core contracts without replacing the existing API, worker, daemon, approval engine, policy engine, or repo-proof packages.

## Session Reducer

`packages/session-engine` owns session transition rules.

Allowed high-level path:

`created -> preparing -> ready|needs_approval -> running -> verifying -> completed`

Resumability path:

`ready|running|blocked|needs_approval|verifying|paused -> resuming -> ready|running|needs_approval|paused`

Terminal states:

- `completed`
- `failed`
- `cancelled`

Terminal sessions do not resume. Illegal transitions throw `InvalidSessionTransitionError`.

## Approval Semantics

`packages/approval-engine` owns human approval resolution:

- resolvable states: `pending`, `waiting_human`
- resolved states: `approved_once`, `approved_phase`, `approved_session`, `denied`, `expired`, `superseded`
- callbacks may include nonce; mismatched nonce is rejected
- repeated callbacks after a resolved state are idempotent and do not create a second dispatch

API still accepts legacy approve/reject commands and Wave 2 callback contracts.

## Policy Scope

`packages/policy-engine` filters policies by layer and `scopeRef` before evaluating rules. Global deny still wins over lower-layer approval or allow. Lower scopes cannot weaken a higher deny because deny selection is performed over the effective scoped match set before approval/allow.

## Tool Execution Model

`packages/runtime-adapters` classifies tool actions:

- `safe_read`: default allow, parallel read lane
- `bounded_compute`: default allow, parallel read lane with evidence
- `repo_mutation`: require approval, serial mutation lane
- `shell_network_system_sensitive`: require approval, serial mutation lane
- `deploy_publish_external_side_effect`: deny by default in MVP

`planToolExecutionBatches` batches safe reads together and emits each mutation/sensitive/deploy action as its own serial batch.

## Proof Lifecycle

`packages/repo-proof` keeps `task.json` for compatibility and `state.json` as the canonical phase cursor.

New helpers:

- `readTaskBundleState`
- `advanceTaskPhase`
- `recordTaskApproval`
- `markVerificationStaleAfterMutation`

If a mutation happens after a passed verification, verification becomes `stale` and a fresh verifier pass is required before completion can be trusted.

## API Integration

`apps/api` now uses the reducer in session create, approval resolution, daemon ack/update/complete, and resume paths. Approval resolution uses the idempotent approval-engine path so replayed callbacks do not enqueue duplicate dispatches.

## Migration Notes

Old persisted stores that still contain pre-Wave-1 state names must be migrated before strict production use. Wave 3 does not add a database migration because current persistence is file-backed dev state; future DB migrations should map:

- `prefetching` -> `preparing`
- `pending_dispatch` -> `ready`
- `awaiting_approval` -> `needs_approval`
- `reconnecting` -> `resuming`
