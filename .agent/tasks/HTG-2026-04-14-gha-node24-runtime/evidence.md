# Evidence Summary

## Root Cause

1. The warning source was the action runtime inside three JavaScript actions, not the job's configured `node-version: 22`. Both `.github/workflows/ci.yml` and `.github/workflows/release.yml` referenced `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4`.
2. Upstream metadata for those `@v4` tags still declares `runs.using: node20`, which matches GitHub's deprecation warning. The corresponding maintained `@v5` releases switch those actions to `node24`.
3. Repository inspection found no local composite or JavaScript actions and no reusable workflow files beyond the two tracked workflow files under `.github/workflows/`.

## Changed Files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/spec.md`
- `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/evidence.md`
- `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/evidence.json`
- `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/verdict.json`
- `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/problems.md`

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| All workflow/action references in scope were inspected. | `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/verify.txt`, `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/test-unit.txt` |
| Deprecated Node 20 action-runtime references were updated conservatively. | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/test-unit.txt` |
| No known old references remain in tracked repo files in scope. | `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/test-integration.txt` |
| Workflow YAML remains locally valid and limitations are documented. | `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/lint.txt`, `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/build.txt`, `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/verify.txt` |

## Verification

- Parsed `.github/workflows/ci.yml` with `pnpm dlx js-yaml`
- Parsed `.github/workflows/release.yml` with `pnpm dlx js-yaml`
- Re-scanned tracked repo files for `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, and `runs.using: node20`
- Ran `git diff --check` on the touched workflow and proof files

## Outcomes

- Workflow YAML parsed successfully after the version bumps.
- Current workflow action references are limited to `actions/checkout@v5`, `pnpm/action-setup@v5`, and `actions/setup-node@v5`.
- No deprecated Node 20 runtime references matched in tracked repo files after the change.

## Residual Risk

- The absence of the GitHub-hosted warning can only be fully proven by a fresh remote Actions run after these changes are pushed.
- `actions/checkout@v5` and `actions/setup-node@v5` require modern Actions runners upstream; this repo uses `ubuntu-latest`, so that is acceptable for GitHub-hosted runs.
