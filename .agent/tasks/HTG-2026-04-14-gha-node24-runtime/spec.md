# Task Spec

- Task ID: HTG-2026-04-14-gha-node24-runtime
- Title: Remove GitHub Actions Node 20 deprecation warnings
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

HappyTG `Release` surfaced GitHub's Node 20 action-runtime deprecation warning after the `0.3.4` release. The warning specifically named `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4`, and the same action references are also present in the main CI workflow. The repo needs the underlying action-runtime cause fixed, not silenced, while preserving current CI and release behavior.

## Acceptance Criteria

1. All workflow files in this repository are inspected for action references that still use deprecated Node 20 runtimes, including local or reusable workflow paths if present.
2. Workflows are updated with the most conservative maintained action versions that move those references off the deprecated Node 20 runtime without changing existing CI or release semantics.
3. The repo is re-scanned after the change so no known old references remain in tracked workflow or action metadata within scope.
4. Workflow YAML remains valid under local inspection, and any local verification limitations versus a remote GitHub run are explicitly documented.

## Constraints

- Keep the diff minimal and scoped to GitHub Actions workflow compatibility.
- Do not weaken workflow permissions, security posture, or release/CI gating.
- Prefer upstream-supported action upgrades over warning suppression or no-op workarounds.
- Preserve the existing Node version used by the jobs themselves unless required for runtime compatibility.

## Verification Plan

- Inspect `.github/workflows/*.yml` and any local action metadata for `uses:` and `runs.using`.
- Update only the affected action versions.
- Re-scan the repository for deprecated references after the change.
- Validate workflow YAML locally with the best available static check in this repo.
- Record outputs in:
  - `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/lint.txt`
  - `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-14-gha-node24-runtime/raw/verify.txt`
