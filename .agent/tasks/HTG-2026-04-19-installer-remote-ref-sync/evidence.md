# Evidence Summary

## Acceptance Criteria Mapping

1. Installer update/current repo sync no longer requires checking out the requested local branch.
   - Code: `packages/bootstrap/src/install/repo.ts`
   - Proof: `raw/test-unit.txt` includes `syncRepository updates an existing checkout via the fetched commit without checking out the target branch`.
2. Installer can update to the requested branch tip even when that branch is already occupied by another linked worktree.
   - Code: `packages/bootstrap/src/install/repo.ts`
   - Proof: the sync flow now uses `git fetch`, resolves `FETCH_HEAD^{commit}`, and detaches to that commit instead of checking out the local branch; regression coverage is recorded in `raw/test-unit.txt` and workspace coverage in `raw/test-integration.txt`.
3. Dirty worktree safety behavior remains unchanged for stash/keep/cancel flows.
   - Code: unchanged dirty-worktree branch in `packages/bootstrap/src/install/repo.ts`
   - Proof: bootstrap and workspace test suites remain green in `raw/test-unit.txt` and `raw/test-integration.txt`, including `inspectRepo reports dirty worktrees and defaultDirtyWorktreeStrategy stays safe`.
4. Regression coverage proves update/current sync avoids local target-branch checkout and still updates to the fetched commit.
   - Code: `packages/bootstrap/src/install.runtime.test.ts`
   - Proof: `raw/test-unit.txt`, `raw/test-integration.txt`
5. Task bundle remains valid and fresh verification evidence is recorded.
   - Proof: `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/build.txt`, `raw/task-validate.txt`

## Artifacts

- `packages/bootstrap/src/install/repo.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/build.txt`
- `raw/task-validate.txt`
