# Evidence

## Status

- Phase: complete
- Task ID: `HTG-2026-04-23-release-043-docker-launch-and-telegram`
- Coordinator: Codex main agent

## Implementation

- Bumped root, app, and package versions to `0.4.3`.
- Added `CHANGELOG.md` entry for the actual `v0.4.2..main` commit set: local Mini App diagnostics, Telegram Mini App menu launch, Windows polling fallback, and installer Docker launch mode.
- Added [`docs/releases/0.4.3.md`](../../../../docs/releases/0.4.3.md) with upgrade notes for `docker compose --env-file .env`, explicit installer launch modes, and host-daemon separation.
- Updated [`README.md`](../../../../README.md) so the documentation map points at the current release notes.

## Commands Run

- `git log --oneline v0.4.2..origin/main`
- `pnpm release:check --version 0.4.3`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Evidence Files

- `raw/init-analysis.txt`
- `raw/spec-freeze.txt`
- `raw/release-check.txt`
- `raw/typecheck.txt`
- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`

## Notes

- `pnpm release:check --version 0.4.3` passed and confirmed 16 package versions plus matching changelog/release notes metadata.
- `pnpm test` is the repo-wide verification command for this release; there is no separate release-only integration command, and `raw/test-integration.txt` records that distinction explicitly.
- Local verification leaves publish unblocked for PR, merge, and the GitHub `Release` workflow from `main`.
