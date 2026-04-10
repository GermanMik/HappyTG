# Evidence Summary

## Root Cause

1. The repo had release metadata, but no guarded automation for turning that metadata into a tag plus GitHub Release. Existing CI only verified code on push/PR and never validated release notes, changelog alignment, or version consistency before publication.
2. The repo tree also contained only one clearly safe cleanup target class: generated `.turbo` and `dist` directories recreated by local verification. The tracked `.agent/tasks/HTG-*` trees are canonical proof history, so deleting them automatically would be unsafe.

## Changed Files

- `package.json`
- `.github/workflows/release.yml`
- `scripts/release/validate-release.mjs`
- `CHANGELOG.md`
- `docs/release-process.md`
- `README.md`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Safe tag + GitHub Release automation exists for the default branch. | `.github/workflows/release.yml`, `docs/release-process.md`, `README.md` |
| Release automation validates version and notes before publishing and rejects unsafe states. | `scripts/release/validate-release.mjs`, `.github/workflows/release.yml`, `.agent/tasks/HTG-2026-04-10-release-automation/raw/test-unit.txt` |
| The automation reuses repo conventions instead of inventing a new release system. | `package.json`, `CHANGELOG.md`, `docs/releases/0.2.0.md`, `docs/release-process.md` |
| Only clearly unnecessary generated directories were removed. | Local cleanup of `.turbo` and `dist` trees after verification; tracked `.agent/tasks/HTG-*` directories intentionally retained as proof history. |
| Relevant verification passes. | `.agent/tasks/HTG-2026-04-10-release-automation/raw/lint.txt`, `.agent/tasks/HTG-2026-04-10-release-automation/raw/typecheck.txt`, `.agent/tasks/HTG-2026-04-10-release-automation/raw/test-unit.txt`, `.agent/tasks/HTG-2026-04-10-release-automation/raw/test-integration.txt`, `.agent/tasks/HTG-2026-04-10-release-automation/raw/build.txt` |

## Verification

- `pnpm release:check --version 0.2.0`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- confirmed that generated `.turbo` / `dist` directories were removed after verification

## Outcomes

- `pnpm release:check --version 0.2.0`: passed
- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm test`: passed
- `pnpm build`: passed

## Cleanup Review

- Removed:
  - generated `.turbo` directories
  - generated `dist` directories
- Retained:
  - tracked `.agent/tasks/HTG-*` proof bundles, because they are canonical historical evidence in this repo rather than disposable generated output
