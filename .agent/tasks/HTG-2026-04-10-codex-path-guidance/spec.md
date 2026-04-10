# Task Spec

- Task ID: HTG-2026-04-10-codex-path-guidance
- Title: Add Codex PATH vs reinstall guidance to project checks
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

When Codex is missing, the current HappyTG checks stop at a generic "install Codex CLI" message. The user needs a more useful diagnostic path:

1. explain that Codex is not on the current shell PATH yet
2. check the global npm prefix and installed wrapper files to distinguish a PATH issue from a partial install
3. if Codex still is not found, recommend reinstalling Codex and updating PATH

## Acceptance Criteria

1. Missing-Codex guidance in project checks mentions PATH explicitly and escalates to reinstall + PATH update when Codex is still absent.
2. Bootstrap diagnostics inspect the global npm prefix and Codex wrapper files so the message can distinguish PATH issues from missing/partial install cases.
3. Host-daemon/runtime missing guidance stays consistent with the new project-check language.
4. Regression tests cover the PATH-issue and missing/partial-install cases.
5. `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Constraints

- Keep scope limited to Codex missing guidance and related diagnostics/tests/docs.
- Do not change unrelated release automation work already present in the worktree.
- Do not broaden into general package-manager or installer redesign.

## Verification Plan

- Update focused tests in:
  - `packages/bootstrap/src/index.test.ts`
  - `packages/bootstrap/src/cli.test.ts`
  - `apps/host-daemon/src/index.test.ts`
  - any runtime-adapters test that relies on the generic missing message
- Run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Record outputs in:
  - `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/typecheck.txt`
  - `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-10-codex-path-guidance/raw/lint.txt`
