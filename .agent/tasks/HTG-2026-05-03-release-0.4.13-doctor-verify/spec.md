# HTG-2026-05-03-release-0.4.13-doctor-verify Spec

## Scope

- Prepare and publish HappyTG `0.4.13` as a patch release for the already-merged doctor/verify warning cleanup from PR #54.
- Confirm `v0.4.12` is already published before bumping versions.
- Update every workspace `package.json` from `0.4.12` to `0.4.13`.
- Update `CHANGELOG.md`.
- Add `docs/releases/0.4.13.md`.
- Run release-safe verification and capture raw evidence.
- Open, merge, and publish the GitHub Release after CI passes.

## Non-Goals

- Do not change runtime behavior beyond release metadata.
- Do not alter the doctor/verify fix from PR #54 unless release verification exposes a blocker.
- Do not publish npm packages.
- Do not touch unrelated dirty worktree state.

## Acceptance Criteria

- All workspace package manifests report `0.4.13`.
- `pnpm release:check --version 0.4.13` passes.
- Standard repo checks and `pnpm happytg doctor` / `pnpm happytg verify` pass.
- Task validation for this release bundle passes.
- Fresh verifier reviews spec, diff, raw evidence, release metadata, and verdict.
- PR is merged to `main`, tag/release `v0.4.13` is published, and release branch is deleted.

## Frozen

Spec frozen before production-code edits on 2026-05-03.
