# Task Spec

- Task ID: HTG-2026-04-25-release-046-installer-progress-ux
- Title: Release HappyTG 0.4.6 for installer progress UX
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

The installer progress UX update has been merged to `main` in PR #34 but is not included in a published HappyTG release. The repository release process requires version-aligned metadata, changelog and release notes, local release validation, merge to `main`, and publication through the guarded GitHub Actions `Release` workflow.

## Acceptance Criteria

1. Workspace package versions are aligned at `0.4.6`.
2. `CHANGELOG.md` contains a `## v0.4.6` section describing the installer progress UX change.
3. `docs/releases/0.4.6.md` exists with the expected `# HappyTG 0.4.6` heading and version bullet.
4. `pnpm release:check --version 0.4.6` passes locally.
5. Release branch is committed, pushed, merged to `main`, and GitHub Release `v0.4.6` is published from the latest `main` through the repository Release workflow.
6. Release proof evidence records local checks, PR/merge details, workflow details, and release details.

## Constraints

- Do not change product runtime behavior beyond release metadata.
- Use the repository guarded Release workflow instead of manual local tags.
- Keep unrelated untracked files outside the release commit.
- Preserve proof-loop artifacts under this task bundle.

## Verification Plan

- `pnpm release:check --version 0.4.6`
- `pnpm happytg task validate --repo . --task HTG-2026-04-25-release-046-installer-progress-ux`
- GitHub PR checks before merge
- GitHub Release workflow run for `0.4.6`
