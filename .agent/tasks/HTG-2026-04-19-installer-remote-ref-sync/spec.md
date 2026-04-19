# Task Spec

- Task ID: HTG-2026-04-19-installer-remote-ref-sync
- Title: Remove installer dependency on local main branch checkout
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG installer repo sync currently handles `update` and `current` modes by fetching the requested branch and then running `git checkout <branch>` followed by `git pull --ff-only <url> <branch>` in `packages/bootstrap/src/install/repo.ts`.

That implementation incorrectly depends on the local branch itself being available in the target worktree. On repositories that already use linked worktrees, Git rejects `git checkout main` when `main` is already checked out elsewhere, even if the requested remote branch tip is otherwise fetchable and valid. The installer therefore fails with errors such as `fatal: 'main' is already used by worktree ...` even though the actual install intent is just "sync this checkout to the requested branch state".

The fix must remove the local target-branch checkout requirement for update/current flows while preserving the requested branch semantics and existing dirty-worktree safety behavior.

## Acceptance Criteria

1. Installer update/current repo sync no longer requires checking out the requested local branch.
2. Installer can update to the requested branch tip even when that branch is already occupied by another linked worktree.
3. Dirty worktree safety behavior remains unchanged for stash/keep/cancel flows.
4. Regression coverage proves update/current sync avoids local target-branch checkout and still updates to the fetched commit.
5. Task bundle remains valid and fresh verification evidence is recorded.

## Constraints

- Runtime: Codex CLI, clean dedicated worktree on `codex/installer-remote-ref-sync`.
- Keep the installer `--branch` contract intact: the requested branch still determines the synced code state.
- Do not solve this with destructive Git commands or by weakening dirty-worktree protections.
- Keep the diff minimal and scoped to installer repo-sync behavior plus tests/evidence.
- Fresh verification must be recorded after implementation.

## Verification Plan

- Unit: extend `packages/bootstrap/src/install.runtime.test.ts` with a regression covering update/current sync against a fetched commit without local branch checkout.
- Integration: run scoped bootstrap tests plus repo checks needed by the touched code.
- Manual: confirm the updated sync flow uses fetch + detached commit checkout instead of `git checkout <branch>` / `git pull`.
- Evidence files to produce:
  - `raw/build.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/lint.txt`
  - `raw/typecheck.txt`
  - `raw/task-validate.txt`
