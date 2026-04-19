# HTG-2026-04-19-release-0317-installer-final-summary-exit

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the validated installer final-summary/exit hardening follow-up as release `0.3.17` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.16` to `0.3.17`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.17.md`.
- Include the validated source proof bundle `HTG-2026-04-19-installer-final-summary-exit`.
- Create and finalize a release proof bundle for `0.3.17`.
- Run release metadata and verification checks locally.
- Commit and push the release metadata to GitHub.
- Merge the release PR to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.17`.

## Out Of Scope

- New installer/runtime fixes beyond the already validated final-summary/exit and CLI-wrapper coverage.
- Auth or security model changes around Telegram `/pair`.
- Unrelated workspace cleanup outside the release/proof scope.

## Acceptance Criteria

1. All workspace `package.json` versions, `CHANGELOG.md`, and `docs/releases/0.3.17.md` are aligned at `0.3.17`.
2. The source proof bundle `HTG-2026-04-19-installer-final-summary-exit` remains the canonical code-change evidence for this release.
3. Fresh release verification passes after the metadata bump.
4. The release proof bundle is complete and validates successfully.
5. The release branch commit is pushed and merged to `main`.
6. The guarded `Release` workflow is dispatched for `0.3.17` from the latest `main` HEAD.

## Completion Notes

- This release is primarily a proof-hardening and CLI-wrapper verification follow-up for the installer final-summary/exit work already validated in the source task.
