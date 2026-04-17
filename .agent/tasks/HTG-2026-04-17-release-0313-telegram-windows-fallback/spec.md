# Task Spec

- Task ID: HTG-2026-04-17-release-0313-telegram-windows-fallback
- Title: Release 0.3.13 Windows Telegram transport fallback
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The Windows Telegram transport fallback fix is implemented and already proven in `.agent/tasks/HTG-2026-04-17-telegram-windows-transport-fallback/`, but the workspace is still versioned at `0.3.11` and has no aligned `0.3.13` changelog or release notes entry. This task is limited to shipping that verified fix as release `0.3.13` with aligned workspace versions, changelog, release notes, and fresh release validation.

## Acceptance Criteria

1. Workspace versions, `CHANGELOG.md`, and `docs/releases/0.3.13.md` are aligned at `0.3.13`.
2. Fresh release verification passes after the version bump: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm release:check --version 0.3.13`.
3. Release notes truthfully describe the Windows Telegram transport fallback scope and reference the canonical fix bundle.

## Constraints

- Runtime: Codex CLI.
- Keep the diff limited to the already-verified product fix, release metadata, and proof artifacts.
- Do not widen scope beyond the Windows Telegram transport fallback and its release packaging.
- Preserve truthful wording about the maintainer machine: the direct Node HTTPS timeout still reproduces, while the fallback path and negative controls are what was validated.
- Out of scope:
  - new production fixes beyond the already-verified transport fallback diff;
  - unrelated docs cleanup;
  - GitHub Actions release execution or tag creation.

## Verification Plan

- Source proof: validate `.agent/tasks/HTG-2026-04-17-telegram-windows-transport-fallback/`.
- Release checks: run `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm release:check --version 0.3.13`.
- Proof: record raw command output under this task directory and validate the release bundle with `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0313-telegram-windows-fallback`.
