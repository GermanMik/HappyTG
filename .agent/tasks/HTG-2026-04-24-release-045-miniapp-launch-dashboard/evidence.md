# Evidence

Status: complete.

## Release Metadata

- Target version: `0.4.5`
- Release notes: `docs/releases/0.4.5.md`
- Changelog section: `CHANGELOG.md` `v0.4.5`
- Source proof bundles:
  - `.agent/tasks/HTG-2026-04-24-miniapp-does-not-open/`
  - `.agent/tasks/HTG-2026-04-24-miniapp-dashboard-api-route/`

## Verification

- `pnpm release:check --version 0.4.5`: see `raw/release-check.txt`
- PR `#32` merged to `main` as `b09b8207cef017b856bde023ed4380c12c1550be`: see `raw/release-pr.json`
- GitHub Actions `Release` workflow run `24902224045` completed successfully on `main`: see `raw/release-workflow.json`
- GitHub Release `v0.4.5` is published and targets `b09b8207cef017b856bde023ed4380c12c1550be`: see `raw/github-release.json`
