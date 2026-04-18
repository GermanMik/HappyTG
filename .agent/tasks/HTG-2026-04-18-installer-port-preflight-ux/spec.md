# Task Spec

- Task ID: HTG-2026-04-18-installer-port-preflight-ux
- Title: Installer port preflight UX
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

HappyTG bootstrap/setup can already classify planned ports, but installer currently treats that data as passive follow-up. It does not stop during interactive install to resolve real port conflicts, it exposes only one suggested port instead of three nearby free candidates, and it does not persist an explicit user-selected replacement port into the same .env path before later startup guidance.

## Acceptance Criteria

1. Installer preflights all planned HappyTG ports before service start and distinguishes supported reuse from real conflicts.
2. Interactive install offers three nearby free ports, manual entry, and abort, then saves the explicit override into .env without silent rebinds.
3. Bootstrap/setup diagnostics preserve env override precedence, expose listener attribution, and stay covered by deterministic regression tests and proof artifacts.

## Constraints

- Runtime: Codex CLI / bootstrap installer flow
- Preserve explicit env override precedence, including HAPPYTG_*_PORT before PORT for app services.
- No hidden auto-rebinds or suppressed warnings.
- Keep supported reuse semantics intact for expected HappyTG services and supported infra listeners.
- Minimize churn outside bootstrap/install UX, proof artifacts, and release metadata used by the repo.

## Verification Plan

- Unit: bootstrap tests for multi-port suggestions and conflict wording; installer TUI/runtime tests for suggested-port choice, manual entry, supported reuse, and abort.
- Integration: pnpm --filter @happytg/bootstrap test.
- Manual: pnpm happytg setup --json and release-check/task-validate after changes.
- Evidence files to produce: raw build/typecheck/lint/test-unit/test-integration/task-validate/release-check artifacts plus synced evidence/verdict summaries.

