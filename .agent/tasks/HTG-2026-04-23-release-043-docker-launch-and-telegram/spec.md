# HTG-2026-04-23-release-043-docker-launch-and-telegram Spec

## Scope

Release HappyTG `0.4.3` from the commits currently merged to `main` after `v0.4.2`, covering the installer Docker launch mode, Telegram Mini App menu launch repair, faster Windows polling fallback, and clearer local Mini App diagnostics.

## Acceptance Criteria

1. Workspace release metadata is aligned at `0.4.3` across root/apps/packages.
2. `CHANGELOG.md` includes a `## v0.4.3` section grounded in the actual merged changes since `v0.4.2`.
3. `docs/releases/0.4.3.md` exists and explains the operator-facing release impact, especially Docker installer startup, Telegram Mini App launch/menu behavior, and Windows polling fallback.
4. README release navigation points to the current release notes instead of a stale older release.
5. `pnpm release:check --version 0.4.3` passes on the release-ready diff.
6. Fresh repo verification passes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
7. The canonical release proof bundle is complete and validates the release task.
8. The release branch is merged to `main`, the GitHub `Release` workflow runs from `main`, and GitHub exposes tag/release `v0.4.3`.

## Verification

- `pnpm release:check --version 0.4.3`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm happytg task validate --repo . --task HTG-2026-04-23-release-043-docker-launch-and-telegram`

## Out Of Scope

- New feature work beyond the already-merged `v0.4.2..main` commit set.
- Rewriting the release workflow or changing release automation policy.
- Backporting additional fixes not already part of `main`.
