# HTG-2026-04-19-release-0319-telegram-windows-polling-fallback

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the validated Windows Telegram polling fallback fix as release `0.3.19` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.18` to `0.3.19`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.19.md`.
- Include the validated source proof bundle `HTG-2026-04-19-telegram-start-still-silent`.
- Create and finalize a release proof bundle for `0.3.19`.
- Run release metadata and verification checks locally in a clean worktree.
- Commit and push the release branch to GitHub.
- Merge the release PR to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.19`.

## Out Of Scope

- New workspace/archive/install changes currently present in other dirty worktrees.
- Broader Telegram transport refactors outside the bounded polling/webhook inspection fallback fix.
- Webhook auto-registration or Telegram auth/security-model changes.

## Acceptance Criteria

1. All workspace `package.json` versions, `CHANGELOG.md`, and `docs/releases/0.3.19.md` are aligned at `0.3.19`.
2. The source proof bundle `HTG-2026-04-19-telegram-start-still-silent` remains the canonical code-change evidence for the release.
3. Fresh release verification passes after the metadata bump.
4. The release proof bundle is complete and validates successfully.
5. The release branch commit is pushed and merged to `main`.
6. The guarded `Release` workflow is dispatched for `0.3.19` from the latest `main` HEAD and completes successfully.

## Completion Notes

- This release is a follow-up product fix for Windows hosts where Node/undici cannot reach Telegram Bot API but PowerShell can, preventing local polling from staying silently degraded after `0.3.18`.
