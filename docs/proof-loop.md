# Proof Loop

## Canonical Source of Truth

HappyTG uses `.agent/tasks/<TASK_ID>/` as the canonical proof bundle location.

## Required Files

- `spec.md`
- `evidence.md`
- `evidence.json`
- `verdict.json`
- `problems.md`
- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`

## Phase Order

1. init
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
