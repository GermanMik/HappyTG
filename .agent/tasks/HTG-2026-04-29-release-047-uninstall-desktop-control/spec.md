# HTG-2026-04-29-release-047-uninstall-desktop-control

## Scope

Prepare and publish HappyTG 0.4.7 from current main after PR #37-#41.

## Acceptance Criteria

- Workspace package versions are aligned at 0.4.7.
- CHANGELOG.md has a v0.4.7 section.
- docs/releases/0.4.7.md exists with release notes.
- Local release validation passes.
- Standard repo checks pass or any environment warnings are recorded.
- Release metadata is merged to main before running the guarded Release workflow.
- GitHub Release v0.4.7 is created by the Release workflow.

## Included Changes

- Telegram bot/API session cancel control.
- Codex Desktop control surfaces and runtime adapter support.
- Docker installer Compose port/naming repairs and optional Telegram env confirmation.
- Bootstrap uninstall command with owned launcher artifact cleanup.

## Out Of Scope

- New product changes beyond release metadata.
- Manual tag creation outside the guarded Release workflow.
