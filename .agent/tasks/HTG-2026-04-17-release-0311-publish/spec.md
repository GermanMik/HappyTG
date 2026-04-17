# Task Spec

- Task ID: HTG-2026-04-17-release-0311-publish
- Title: Release 0.3.11 bootstrap/install regressions
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The bootstrap/install regression fix for release `0.3.11` is implemented locally and already has a completed proof bundle in `.agent/tasks/HTG-2026-04-17-release-0311-bootstrap-install-regressions/`, but the workspace is still versioned at `0.3.10` and no `0.3.11` release metadata, GitHub PR/merge, tag, or GitHub Release exists yet. This task is limited to shipping that verified installer/bootstrap/TUI fix as release `0.3.11` with aligned workspace versions, changelog, release notes, release validation, and publish artifacts.

## Acceptance Criteria

1. Workspace versions, changelog, and docs/releases/0.3.11.md are aligned at 0.3.11.
2. Release validation and repo checks pass for 0.3.11.
3. GitHub PR, merge, tag, and release for v0.3.11 are completed from the verified diff.

## Constraints

- Runtime: Codex CLI.
- Fresh verifier required before commit/push/PR merge/tag/release.
- Keep the diff limited to the already-verified product changes for `0.3.11`, release metadata, proof artifacts, and publish records.
- Preserve truthful environment warnings in release notes; do not claim the installer is fully green on the maintainer machine when the evidence still shows legitimate Codex websocket / Mini App port warnings.
- Out of scope:
  - new production fixes beyond the already-verified `0.3.11` bugfix diff;
  - unrelated docs cleanup;
  - release-process refactors unrelated to publishing `0.3.11`.

## Verification Plan

- Unit: rely on the existing completed proof bundle for the product fix and rerun `pnpm test` on the release branch.
- Integration: rerun `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm release:check --version 0.3.11`; validate the release proof bundle with `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0311-publish`.
- Manual/proof:
  - align workspace versions and release notes;
  - reference the completed fix bundle `.agent/tasks/HTG-2026-04-17-release-0311-bootstrap-install-regressions/`;
  - create a release branch, commit, push, PR, merge, tag, and GitHub Release only after a fresh verifier pass.
