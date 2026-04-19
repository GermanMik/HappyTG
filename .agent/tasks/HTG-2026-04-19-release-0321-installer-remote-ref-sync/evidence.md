# Evidence

## Local Verification

- Clean release worktree: `C:\Develop\Projects\HappyTG-release-0321-installer-remote-ref-sync`
- Base commit before release metadata: `746951f`
- Target version: `0.3.21`
- Canonical source proof bundle: `HTG-2026-04-19-installer-remote-ref-sync`

### Metadata

- All workspace `package.json` versions were bumped from `0.3.20` to `0.3.21`.
- `CHANGELOG.md` gained a `## v0.3.21` section describing the installer remote-ref sync release.
- Added release notes at `docs/releases/0.3.21.md`.

### Commands

- `pnpm install --frozen-lockfile`
- `pnpm --filter @happytg/bootstrap run test`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run build`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-remote-ref-sync`
- `pnpm release:check --version 0.3.21`
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

- Release branch commit: `72013b1` on `codex/release-0.3.21-installer-remote-ref-sync`
- Merged to `main` as commit `3e93fee8bcff9cdd64febd1b010af886dff80eae`
- GitHub Actions workflow: `Release` run `24636159603`
- Workflow URL: `https://github.com/GermanMik/HappyTG/actions/runs/24636159603`
- GitHub Release URL: `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.21`
- Published tag: `v0.3.21`

### Final Raw Artifacts

- `raw/workflow-run.json`
- `raw/github-release.json`
- `raw/git-tag.txt`
- `raw/task-validate.txt`
