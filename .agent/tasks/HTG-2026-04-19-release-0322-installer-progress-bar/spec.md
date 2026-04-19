# HTG-2026-04-19-release-0322-installer-progress-bar

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the current installer progress-bar change as release `0.3.22` from branch `codex/htg-2026-04-19-installer-progress-bar`, then fast-forward `main` and dispatch the guarded release workflow from the latest default-branch HEAD.

## In Scope

- Bump all workspace package versions from `0.3.21` to `0.3.22`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.22.md`.
- Reference the validated source proof bundle `HTG-2026-04-19-installer-progress-bar`.
- Create and finalize a dedicated release proof bundle for `0.3.22`.
- Run release metadata and verification checks locally against the current branch content.
- Commit and push the release-ready branch state.
- Fast-forward `main` to the release-ready commit.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.22`.

## Out Of Scope

- New installer, bot, API, workspace, or daemon product changes outside the already-scoped installer progress-bar work.
- Bypassing the repo's main-only guarded release workflow by tagging directly from a feature branch.
- Publishing unrelated dirty-worktree changes from other tasks.

## Acceptance Criteria

1. All workspace package versions, `CHANGELOG.md`, and `docs/releases/0.3.22.md` are aligned at `0.3.22`.
2. The installer progress-bar change from `HTG-2026-04-19-installer-progress-bar` remains the canonical product evidence for this release.
3. Fresh release validation passes after the metadata bump.
4. The release-ready commit is pushed on `codex/htg-2026-04-19-installer-progress-bar`, and `main` is fast-forwarded to that exact commit.
5. The guarded GitHub `Release` workflow creates `v0.3.22` from the latest `main` HEAD and the release proof bundle is finalized truthfully.

## Completion Notes

- This release packages the installer TUI improvement that adds an aggregate ASCII-safe progress bar for the full install flow, so slow steps no longer look frozen while preserving the existing step-state semantics.
