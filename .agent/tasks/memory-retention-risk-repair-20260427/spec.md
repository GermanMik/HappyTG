# memory-retention-risk-repair-20260427 Spec

## Status

Frozen at 2026-04-27 before production edits.

## Objective

Repair the resource-retention risks confirmed by `.agent/tasks/memory-leak-audit-20260426/` with the smallest safe, verifiable code changes.

## Source Evidence

- `.agent/tasks/memory-leak-audit-20260426/spec.md`
- `.agent/tasks/memory-leak-audit-20260426/evidence.md`
- `.agent/tasks/memory-leak-audit-20260426/problems.md`
- `.agent/tasks/memory-leak-audit-20260426/verdict.json`
- `.agent/tasks/memory-leak-audit-20260426/raw/`

## In Scope

- H1: deterministic child-process timeout settlement for `runCodexExec`/shared command execution.
- M1: bounded stdout/stderr retention with truncation metadata while preserving useful proof output.
- M2: control-plane compaction for expired Mini App launch grants, expired/revoked sessions, stale host registrations, terminal approvals, and completed/failed dispatches when safe.
- M3: reduce serialized `FileStateStore.update(async ...)` retention behind slow proof-bundle filesystem work, or document residual risk if a store-only refactor is unsafe.
- L1: cheap opportunistic Telegram task wizard draft sweep.
- L2: Mini App initData retry timer de-duplication.
- Focused tests for the touched runtime surfaces.
- Proof evidence under this task bundle.

## Out of Scope

- Storage redesign or database replacement.
- Approval, policy, pairing, Telegram auth, Mini App auth, host binding, or public API weakening.
- Broad refactors unrelated to the confirmed retention findings.
- Heavy new dependencies for memory smoke testing.
- Fixing unrelated existing dirty worktree changes unless they are directly required by this task.

## Acceptance Criteria

- The proof bundle contains `spec.md`, `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, and raw command outputs.
- H1 is fixed or explicitly proven not fixable in this scope.
- M1, M2, and M3 are fixed or reduced with documented residual risk.
- L1 and L2 are fixed if the changes remain small.
- Existing Telegram polling/webhook, Mini App auth, proof-loop, daemon dispatch, policy, and approval behavior remain compatible.
- Tests cover child-process timeout resolution, output caps/truncation metadata, retention compaction boundaries, store queue behavior around proof filesystem operations, wizard draft expiry sweep, and Mini App retry de-duplication.

## Required Verification

Record command output under `.agent/tasks/memory-retention-risk-repair-20260427/raw/`:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg verify`

Also run focused package tests for the packages actually touched, using the package names and scripts present in this repository.

## Dynamic Verification

Add or run a lightweight memory/resource smoke where practical. Prefer a local harness for repeated child-process timeout/output and control-plane compaction scenarios, with `global.gc?.()` and `process.memoryUsage()` samples when available. Do not add heavy dependencies.

## Role Discipline

- Builder/fixer edits production code and tests only after this spec is frozen.
- Fresh verifier pass is read-only and records command results/evidence before completion.
