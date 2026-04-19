# HTG-2026-04-19-release-0320-pnpm-build-script-warning-guard

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the validated installer pnpm ignored-build-scripts guard as release `0.3.20` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.19` to `0.3.20`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.20.md`.
- Reference the validated source proof bundle `HTG-2026-04-19-pnpm-build-script-warning-guard`.
- Create and finalize a release proof bundle for `0.3.20`.
- Run release metadata and verification checks locally in a clean worktree.
- Commit and push the release branch to GitHub.
- Merge the release branch to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.20`.

## Out Of Scope

- New installer, bot, API, workspace, or daemon changes outside the already-merged pnpm warning guard.
- Reworking pnpm policy, auto-approving build scripts, or changing the security stance already fixed by the source task.
- Cleaning or publishing unrelated dirty worktree changes from other local branches.

## Acceptance Criteria

1. All workspace `package.json` versions, `CHANGELOG.md`, and `docs/releases/0.3.20.md` are aligned at `0.3.20`.
2. The source proof bundle `HTG-2026-04-19-pnpm-build-script-warning-guard` remains the canonical code-change evidence for the release.
3. Fresh release verification passes after the metadata bump.
4. The release proof bundle is complete and validates successfully.
5. The release branch commit is pushed and merged to `main`.
6. The guarded `Release` workflow is dispatched for `0.3.20` from the latest `main` HEAD and completes successfully.

## Completion Notes

- This release packages the installer hardening that classifies pnpm ignored-build-scripts warnings honestly, validates the repo-local `tsx`/`esbuild` bootstrap path, and removes misleading `approve-builds` guidance on runtimes that do not support it.
