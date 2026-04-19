# Evidence

## Local Verification

- Clean release worktree: `C:\Develop\Projects\HappyTG-release-0320-pnpm-build-script-warning-guard`
- Base commit before release metadata: `93d3fad`
- Target version: `0.3.20`
- Canonical source proof bundle: `HTG-2026-04-19-pnpm-build-script-warning-guard`

### Metadata

- All workspace `package.json` versions were bumped from `0.3.19` to `0.3.20`.
- `CHANGELOG.md` gained a `## v0.3.20` section describing the installer pnpm warning guard.
- Added release notes at `docs/releases/0.3.20.md`.

### Commands

- `pnpm install --frozen-lockfile`
- `pnpm --filter @happytg/bootstrap run test`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run build`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-pnpm-build-script-warning-guard`
- `pnpm release:check --version 0.3.20`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

### Raw Artifacts

- `raw/install.txt`
- `raw/test-unit.txt`
- `raw/typecheck-bootstrap.txt`
- `raw/build-bootstrap.txt`
- `raw/source-task-validate.txt`
- `raw/release-check.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-integration.txt`
- `raw/build.txt`

## Publish Status

- Pending: commit/push release branch
- Pending: merge to `main`
- Pending: dispatch and complete guarded GitHub Actions `Release` workflow for `0.3.20`
