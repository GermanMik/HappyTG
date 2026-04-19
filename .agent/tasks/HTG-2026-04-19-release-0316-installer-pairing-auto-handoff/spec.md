# HTG-2026-04-19-release-0316-installer-pairing-auto-handoff

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the validated installer pairing handoff fix as release `0.3.16` from the latest `main`.

## In Scope

- Bump all workspace package versions from `0.3.15` to `0.3.16`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.16.md`.
- Include the validated source proof bundle `HTG-2026-04-19-installer-pairing-auto-handoff`.
- Create and finalize a release proof bundle for `0.3.16`.
- Run release metadata and verification checks locally.
- Commit and push the release metadata to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.16`.

## Out Of Scope

- New installer/runtime fixes beyond the already validated pairing handoff changes.
- Additional installer/TUI follow-ups beyond the minimal final-summary close fix included in this release.
- Any auth/security redesign that would bypass Telegram `/pair`.

## Acceptance Criteria

1. All workspace `package.json` versions, `CHANGELOG.md`, and `docs/releases/0.3.16.md` are aligned at `0.3.16`.
2. The source proof bundle `HTG-2026-04-19-installer-pairing-auto-handoff` remains the canonical code-change evidence for this release.
3. Fresh release verification passes after the metadata bump.
4. The release proof bundle is complete and validates successfully.
5. The release metadata commit is pushed to `main`.
6. The guarded `Release` workflow is dispatched for `0.3.16` from the latest `main` HEAD.
7. The interactive installer final summary closes cleanly on `Enter` and returns the shell prompt.

## Completion Notes

- This release ships the installer pairing handoff fix and the minimal final-summary close follow-up required to let the interactive command return cleanly after `Enter`.
