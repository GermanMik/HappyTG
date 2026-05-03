# HTG-2026-05-03-usability-release-0.4.12 Spec

## Scope

- Release the merged HappyTG Mini App and Telegram Bot usability/design pass as `v0.4.12`.
- Verify that `v0.4.11` is already published before bumping versions.
- Update every workspace `package.json` version to `0.4.12`.
- Update `CHANGELOG.md`.
- Add `docs/releases/0.4.12.md`.
- Run release validation and standard repo checks.
- Open a PR, wait for CI, merge, publish GitHub Release `v0.4.12`, and clean up the task branch.
- Start/show the Mini App interface after release work and capture a screenshot.

## Non-Goals

- No production runtime behavior changes beyond release metadata.
- No backend policy, approval, serialized mutation, source/runtime, or Telegram callback contract changes.
- No installer or deployment contract changes.

## Acceptance Criteria

- `pnpm release:check --version 0.4.12` passes.
- Standard repo commands pass or any failure is recorded with residual risk.
- GitHub CI passes before merge.
- GitHub Release `v0.4.12` is published from merged `main`.
- Proof evidence is captured under this task bundle.
- A Mini App screenshot is captured and shown to the user.

## Frozen

Spec frozen before release metadata edits on 2026-05-03.
