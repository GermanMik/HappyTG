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

- Release branch commit: `a4b2a42` on `codex/release-0.3.20-pnpm-build-script-warning-guard`
- Merged to `main` as commit `00732a9be54a193f70137f6fa1d2c4f27d43f46f`
- GitHub Actions workflow: `Release` run `24635223695`
- Workflow URL: `https://github.com/GermanMik/HappyTG/actions/runs/24635223695`
- GitHub Release URL: `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.20`
- Published tag: `v0.3.20`

### Final Raw Artifacts

- `raw/workflow-run.json`
- `raw/github-release.json`
- `raw/git-tag.txt`
- `raw/install-finalize.txt`
- `raw/task-validate.txt`
