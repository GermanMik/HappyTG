# Problems

## Reproduced And Resolved

1. Install finalization collapsed the detected problem and the recommended fix path into one sentence.
   - Impact: install output was harder to scan, and JSON/plain-text/TUI consumers had no shared structured way to present remediation as separate points.
   - Resolution: finalization items now support `solutions`, and install renderers show them as nested bullets under the problem.

2. Direct TUI regression coverage did not explicitly assert warning-item remediation bullets.
   - Impact: the new structured warning path existed in code, but its dedicated final-screen renderer path was only indirectly covered.
   - Resolution: `packages/bootstrap/src/install.test.ts` now checks the warning problem line plus each remediation bullet.

## Residual Truths

- Repo-level `pnpm lint` still succeeds mostly through placeholder `echo "TODO: lint ..."` tasks in many packages.
  - This is an existing repo constraint, not introduced by this fix.
- Live install commands remain environment-mutating; runtime/renderer tests are the safer proof surface for this scoped UX change.
