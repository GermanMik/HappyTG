# HTG-2026-04-17-release-0314-install-problem-solutions

## Release Scope

- Base branch: `origin/main`
- Base version: `0.3.13`
- Target version: `0.3.14`
- Release branch: `codex/release-0.3.14-install-problem-solutions`

## Included Source Bundles

- `HTG-2026-04-17-installer-warning-repair`
- `HTG-2026-04-17-install-problem-solutions`

Both source bundles validated successfully on the release branch before release finalization.

## Release Changes

- Updated all workspace package versions from `0.3.13` to `0.3.14`.
- Added `CHANGELOG.md` entry for `v0.3.14`.
- Added `docs/releases/0.3.14.md`.
- Included the validated source proof bundles for the installer warning repair and structured installer remediation tasks.

## Verification

- `pnpm build` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm --filter @happytg/bootstrap test` -> pass
- `pnpm test` -> pass
- `pnpm release:check --version 0.3.14` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-installer-warning-repair` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-install-problem-solutions` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0314-install-problem-solutions` -> pass

Raw artifacts:

- `raw/build.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/release-check.txt`
- `raw/source-task-validate.txt`
- `raw/task-validate.txt`

## Notes

- Repo-level lint still succeeds largely through placeholder `echo "TODO: lint ..."` tasks in several packages; this remains an existing repository constraint and was not changed by the release.
