# Task Spec

- Task ID: HTG-2026-04-11-installer-resilience-ux
- Title: Installer resilience and UX for 0.3.1
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The existing one-command onboarding flow in packages/bootstrap loses resilience and user trust at runtime: transient repo/network failures and Windows shim spawn failures currently bubble into the top-level CLI catch path, which prints generic usage text instead of installer-native recovery or structured runtime errors. Repeated installer runs also do not reliably preserve previously entered onboarding values before repo sync completes, and the retro TUI does not correctly treat multi-character paste input in Telegram fields. The fix must stay inside the current bootstrap engine and preserve Telegram-first onboarding, Linux compatibility, repo/bootstrap architecture invariants, and existing happytg setup/doctor/repair/verify flows while preparing release 0.3.1.

## Acceptance Criteria

1. Runtime installer failures stay inside installer-native handling and never fall through to CLI usage.
2. Repo sync retries primary source exactly 5 times with visible progress, then automatically tries configured fallback source and reports source selection in summary/JSON.
3. Windows shim execution normalizes broken npm/pnpm-style wrappers and returns structured installer errors instead of ENOENT crashes.
4. Installer state persists user-provided values across reruns and resumes Telegram-first onboarding without re-entering saved data.
5. TUI paste works for Telegram fields without breaking raw-mode navigation/editing.
6. Release metadata and proof bundle are updated for 0.3.1 with required repo verification.

## Constraints

Runtime: Codex CLI
Builder/verifier separation is required; the fresh verifier pass must not edit production code.
Extend the existing packages/bootstrap installer only; do not introduce a parallel standalone installer or alternate messaging-platform UX.
Installer runtime failures must not print the generic CLI usage banner unless the failure is a parse error or unsupported CLI surface.
Repo source resolution, retry/error classification, Windows shim execution, and TUI/runtime rendering should live in explicit helper/resolver layers rather than ad hoc branching across the orchestrator.
Persistence/resume must reuse safe project persistence points, preserve existing .env user values, avoid secret leakage to stdout/stderr, and keep install reruns idempotent.
Telegram does not become an internal transport layer; policy evaluation remains before approval evaluation; serialized mutation handling and lazy/cache-aware heavy initialization remain intact.
If release metadata is touched, workspace/package versions, CHANGELOG.md, and docs/releases/0.3.1.md must align to 0.3.1 and pass release validation.

## Verification Plan

- Unit/build-targeted: pnpm --filter @happytg/bootstrap test
- Repo gates: pnpm lint; pnpm typecheck; pnpm test; pnpm happytg doctor; pnpm happytg verify
- Release validation if metadata changes: pnpm release:check --version 0.3.1
- Behavioral coverage: add tests for repo retry/fallback, structured runtime errors vs usage, Windows shim normalization/fallback execution, resume persistence, env idempotency, and Telegram TUI paste/edit/navigation behavior.
- Record raw outputs in .agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/: build.txt, test-unit.txt, test-integration.txt, lint.txt, typecheck.txt, doctor.txt, verify.txt, and release-check.txt when applicable.
- Proof loop order: init, freeze/spec, build, evidence, fresh verify, minimal fix, fresh verify, complete.

