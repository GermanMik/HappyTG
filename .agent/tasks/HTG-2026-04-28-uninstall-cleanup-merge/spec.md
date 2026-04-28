# HTG-2026-04-28-uninstall-cleanup-merge

## Scope

Audit remaining unmerged branches and merge only branch work that is still missing from current `main`.

## Acceptance Criteria

- Identify stale, already-merged, superseded, and still-needed branches.
- Do not merge old branches whose functionality is already present in `main`.
- If a still-needed branch exists, merge it on a dedicated branch and resolve conflicts minimally.
- Preserve unrelated branch cleanup state and avoid deleting unmerged work without evidence.
- Run targeted verification for merged scope.

## Candidate Needing Merge

- `codex/uninstall-multi-artifact-cleanup`: adds safe `pnpm happytg uninstall` owned-artifact cleanup. Current `main` lacks `packages/bootstrap/src/uninstall/index.ts` and `packages/bootstrap/src/uninstall.test.ts`.

## Out Of Scope

- Rewriting old proof bundles.
- Force-deleting unmerged branches.
- Merging old release artifact-only branches.
