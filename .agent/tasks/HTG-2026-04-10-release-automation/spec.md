# Task Spec

- Task ID: HTG-2026-04-10-release-automation
- Title: Add safe tag and GitHub Release automation
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

HappyTG has release notes and a changelog, but it does not have a safe automated path for creating a release tag and GitHub Release. The current repository also contains generated and historical directory trees, so the task must verify whether any of them are unnecessary and only remove clearly safe candidates.

## Acceptance Criteria

1. The repo has a safe automation path for creating a Git tag and GitHub Release from the default branch.
2. Release automation validates the release version and notes before publishing, and refuses obviously unsafe states such as missing release notes or version mismatch.
3. The automation uses existing repo conventions instead of inventing a broad release system.
4. Repository tree cleanup removes only clearly unnecessary generated directories; canonical proof/history directories remain unless proven unnecessary.
5. Relevant verification passes after the change.

## Constraints

- Keep scope limited to release automation, release validation, and clearly safe directory cleanup.
- Do not redesign package versioning, changelog structure, or CI broadly.
- Do not delete tracked proof bundles unless they are clearly redundant and non-canonical.
- Preserve the existing verification commands and GitHub workflow style where possible.

## Verification Plan

- Add or update:
  - release validation script(s)
  - GitHub workflow(s) for release publication
  - minimal docs if needed for actionability
- Run:
  - targeted release validation command
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Record outputs in:
  - `.agent/tasks/HTG-2026-04-10-release-automation/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-10-release-automation/raw/lint.txt`
  - `.agent/tasks/HTG-2026-04-10-release-automation/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-10-release-automation/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-10-release-automation/raw/typecheck.txt`
