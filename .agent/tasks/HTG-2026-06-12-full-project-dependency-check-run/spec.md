# HTG-2026-06-12-full-project-dependency-check-run

## Scope

Run a full-project dependency-aware verification pass for the current branch in accordance with
`docs/prompts/happytg-full-project-dependency-proof-loop-check.md`.

## Acceptance Criteria

1. Dependency inventory for package manager/workspace/runtime/infrastructure is captured.
2. Dependency audit and outdated checks are executed and recorded.
3. `lint`, `typecheck`, `test`, `build`, `pnpm happytg doctor`, `pnpm happytg verify`, and
   `pnpm happytg task validate` are executed and recorded.
4. Task proof artifacts are complete and internally consistent (`task.json`, `state.json`,
   `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, raw outputs).
5. Final verdict reflects the actual command outcomes.

## Non-goals

- No production code changes are planned in this run.
- No release metadata updates.

## Verification Plan

1. Capture dependency inventory and project state.
2. Run dependency checks (`pnpm audit`, `pnpm outdated`, etc.).
3. Run lint/typecheck/test/build matrix.
4. Run `pnpm happytg doctor`, `pnpm happytg verify`, `pnpm happytg task validate`.
5. Summarize results in evidence and verdict.
