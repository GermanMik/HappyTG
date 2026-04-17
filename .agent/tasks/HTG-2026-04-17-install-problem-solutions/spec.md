# HTG-2026-04-17-install-problem-solutions

## Status

- Phase: complete
- Frozen at: 2026-04-17
- Coordinator: Codex main agent

## Goal

During `pnpm happytg install`, show problem resolution guidance as separate points instead of burying the remediation path inside the same sentence as the detected issue.

## In Scope

- Extend the structured installer finalization item model with optional remediation points.
- Render those remediation points in install plain-text and TUI summaries as separate entries under each relevant problem item.
- Keep install JSON structured so consumers can read the same remediation points.
- Add or update regression coverage in bootstrap CLI/TUI/install tests.

## Out of Scope

- Reworking the underlying diagnostics classification.
- Broad wording changes across setup/doctor/verify beyond what is required by the shared model.
- Release/publish flow.

## Acceptance Criteria

1. Install finalization can represent a problem statement and one or more separate remediation points.
2. Plain-text install output renders remediation points as distinct items rather than merging them into the same sentence as the problem.
3. TUI final screen renders the same remediation points distinctly.
4. Install JSON includes the remediation points in structured finalization items.
5. Existing warning/reuse/conflict/manual classification stays intact and regression tests pass.

## Completion Notes

- Finalized after scoped bootstrap verification and an independent verifier review.
- Proof bundle now reflects the completed proof loop for this task only; no publish/release work was started.
