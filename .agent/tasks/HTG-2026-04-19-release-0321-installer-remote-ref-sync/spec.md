# HTG-2026-04-19-release-0321-installer-remote-ref-sync

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the already-merged installer remote-ref sync fix as release `0.3.21` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.20` to `0.3.21`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.21.md`.
- Reference the validated source proof bundle `HTG-2026-04-19-installer-remote-ref-sync`.
- Create and finalize a dedicated release proof bundle for `0.3.21`.
- Run release metadata and verification checks locally in a clean release worktree.
- Commit and push the release branch to GitHub.
- Merge the release branch to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.21`.

## Out Of Scope

- New installer, bot, API, workspace, or daemon product changes outside the already-merged remote-ref sync fix.
- Reworking the installer semantics beyond the released `FETCH_HEAD` detached-sync behavior already on `main`.
- Publishing unrelated dirty-worktree changes from non-release branches.

## Acceptance Criteria

1. All workspace package versions, `CHANGELOG.md`, and `docs/releases/0.3.21.md` are aligned at `0.3.21`.
2. The installer remote-ref sync fix from `HTG-2026-04-19-installer-remote-ref-sync` remains the canonical product evidence for this release.
3. Fresh release validation passes after the metadata bump.
4. The release branch is committed, pushed, reviewed through PR, and merged to `main`.
5. The guarded GitHub `Release` workflow publishes `v0.3.21` from the latest `main` HEAD and the release proof bundle is finalized.

## Completion Notes

- This release packages the installer fix that removes the dependency on checking out the requested local branch during repo sync, so linked-worktree occupancy no longer blocks `update/current` install flows.
