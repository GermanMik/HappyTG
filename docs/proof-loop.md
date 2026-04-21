# Proof Loop

## Canonical Source of Truth

HappyTG uses `.agent/tasks/<TASK_ID>/` as the canonical proof bundle location.

## Required Files

- `spec.md`
- `state.json`
- `evidence.md`
- `evidence.json`
- `verdict.json`
- `problems.md`
- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`

## Phase Order

1. quick or freeze
2. freeze/spec
3. build
4. evidence
5. fresh verify
6. minimal fix
7. fresh verify
8. complete

## Rules

- do not build before spec freeze,
- do not let verifier modify production code,
- do not mark complete without evidence mapped to acceptance criteria.

## State Cursor

New bundles write `state.json` next to `task.json`. `task.json` is kept for existing CLI compatibility, while `state.json` is the canonical phase cursor for render surfaces and future verifier reads.

`state.json` records:

- `task_id`
- `session_id`
- `current_phase`
- `phase_history`
- `verification_state`
- `approvals`
- `artifact_manifest`
- `unresolved_issues`
- `last_event_cursor`
- `timestamps`

Older bundles without `state.json` remain readable through legacy validation, but new proof-loop work should include it.
