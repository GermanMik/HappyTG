# HTG-2026-04-19-release-0318-telegram-local-dev-polling

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the validated local Telegram polling fix as release `0.3.18` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.17` to `0.3.18`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.18.md`.
- Include the validated source proof bundle `HTG-2026-04-19-telegram-local-dev-polling`.
- Create and finalize a release proof bundle for `0.3.18`.
- Run release metadata and verification checks locally.
- Commit and push the release metadata to GitHub.
- Merge the release PR to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.18`.

## Out Of Scope

- New bot/runtime fixes beyond the already validated local polling and delivery-mode diagnostics work.
- Security-model changes around `/api/v1/pairing/claim`, approval resolution, or daemon auth.
- Automatic webhook registration or webhook-secret enforcement migrations.

## Acceptance Criteria

1. All workspace `package.json` versions, `CHANGELOG.md`, and `docs/releases/0.3.18.md` are aligned at `0.3.18`.
2. The source proof bundle `HTG-2026-04-19-telegram-local-dev-polling` remains the canonical code-change evidence for the release.
3. Fresh release verification passes after the metadata bump.
4. The release proof bundle is complete and validates successfully.
5. The release branch commit is pushed and merged to `main`.
6. The guarded `Release` workflow is dispatched for `0.3.18` from the latest `main` HEAD and completes successfully.

## Completion Notes

- This release is primarily a product fix for honest local Telegram bot delivery in development, plus synchronized documentation and proof artifacts.
