# Task Spec

- Task ID: HTG-2026-04-24-release-045-miniapp-launch-dashboard
- Title: Release HappyTG 0.4.5 Mini App launch and dashboard routing repair
- Owner: codex
- Mode: proof
- Status: frozen

## Problem

The Mini App route identity and dashboard Caddy route fixes are complete locally and need a formal HappyTG release. The release must preserve the narrow public API contract and publish the merged main commit through the guarded GitHub Release workflow.

## Acceptance Criteria

1. Align all workspace package versions to `0.4.5`.
2. Add `CHANGELOG.md` and `docs/releases/0.4.5.md` release metadata.
3. Validate release metadata with `pnpm release:check --version 0.4.5`.
4. Commit, push, merge to `main`, and publish GitHub Release `v0.4.5`.
5. Record release evidence without secrets.

## Verification Plan

- `pnpm release:check --version 0.4.5`
- Reuse source proof bundles:
  - `HTG-2026-04-24-miniapp-does-not-open`
  - `HTG-2026-04-24-miniapp-dashboard-api-route`
- Verify GitHub Release workflow result after merge.
