# Task Spec

- Task ID: HTG-2026-04-17-release-038-installer-diagnostics
- Title: Release 0.3.8 installer diagnostics
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The installer diagnostics fixes for Telegram getMe classification, Windows Codex wrapper/PATH/smoke behavior, and proactive planned-port analysis are already merged on `main`, but the repository is still versioned at `0.3.7` and no `0.3.8` release metadata or GitHub Release exists. This task is limited to shipping those already-landed diagnostics changes as release `0.3.8` with aligned workspace versions, changelog, release notes, release validation, and GitHub publish steps.

## Acceptance Criteria

1. Workspace package versions are aligned at `0.3.8`.
2. `CHANGELOG.md` and `docs/releases/0.3.8.md` accurately describe the installer diagnostics release and its user impact.
3. Release validation and repo checks pass before publish.
4. GitHub release/tag `v0.3.8` is created from the published `main` state using the checked-in release notes.

## Constraints

- Runtime: Codex CLI.
- Fresh verifier required before commit/push/tag/release.
- Keep the diff limited to release metadata, proof artifacts, and publish records for `0.3.8`.
- Do not modify production behavior; the code for this release is already merged.
- Out of scope: new diagnostics fixes, unrelated docs cleanup, and workflow changes unrelated to publishing `0.3.8`.

## Verification Plan

- Unit: reuse current repo test surface; no new product code is expected.
- Integration: validate release metadata against the repo release checker.
- Manual/proof: run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm release:check --version 0.3.8`, and `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-038-installer-diagnostics`, then record GitHub publish artifacts.
