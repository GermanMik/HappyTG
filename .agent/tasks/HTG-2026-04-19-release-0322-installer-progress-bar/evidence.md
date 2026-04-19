# Evidence

## Local Verification

- Branch: `codex/htg-2026-04-19-installer-progress-bar`
- Base release version: `0.3.21`
- Target release version: `0.3.22`
- Canonical source proof bundle: `HTG-2026-04-19-installer-progress-bar`

### Metadata

- All workspace `package.json` versions were bumped from `0.3.21` to `0.3.22`.
- `CHANGELOG.md` gained a `## v0.3.22` section describing the installer progress-bar release.
- Added release notes at `docs/releases/0.3.22.md`.

### Commands

- `pnpm install --frozen-lockfile`
- `pnpm release:check --version 0.3.22`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm happytg doctor`
- `pnpm happytg verify`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-progress-bar`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-release-0322-installer-progress-bar`

### Raw Artifacts

- `raw/install.txt`
- `raw/release-check.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-integration.txt`
- `raw/test-unit.txt`
- `raw/test-integration-first-fail.txt`
- `raw/build.txt`
- `raw/doctor.txt`
- `raw/verify.txt`
- `raw/source-task-validate.txt`

## Publish Status

- Release-prep commit: `c7a7dda` on `codex/htg-2026-04-19-installer-progress-bar`
- Fast-forwarded `main` to `c7a7dda353807ad4adb895aff9bc61abe8b806ed`
- GitHub Actions workflow: `Release` run `24636978193`
- Workflow URL: `https://github.com/GermanMik/HappyTG/actions/runs/24636978193`
- GitHub Release URL: `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.22`
- Published tag: `v0.3.22`

### Final Raw Artifacts

- `raw/workflow-run.json`
- `raw/github-release.json`
- `raw/git-tag.txt`
- `raw/task-validate.txt`

## Notes

- The first `pnpm test` attempt failed on a transient local `apps/api` handoff-port race (`Port 53271 is already in use by another process`) in `startApiServer retries a transient HappyTG API handoff before classifying reuse`.
- The isolated rerun of that exact API test passed, and a full `pnpm test` rerun also passed without any code change, so the release bundle keeps both the first-failure artifact and the successful reruns.
