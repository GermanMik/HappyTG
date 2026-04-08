# Task Spec

- Task ID: HTG-20260408-bootstrap-onboarding
- Title: Windows bootstrap/install/onboarding fixes
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG currently passes install, lint, typecheck, and build on the reported Windows PowerShell setup, but the install/bootstrap/onboarding path still fails users on first run. The known failures are concentrated in a narrow slice: Windows home expansion in `@happytg/shared`, Codex CLI detection under Windows/npm shim semantics, missing first-run guidance for Telegram bot token setup, unclear pairing handoff, missing Redis state detection, and poor handling of common port conflicts such as Mini App `3001` and Redis `6379`. The plain-text bootstrap path is also too implicit for first-time users and does not explain supported alternatives when Redis or ports already exist locally. The task is to fix these install/bootstrap/onboarding/runtime-detection problems without expanding into broader architectural changes, and to update docs plus release/version metadata so the new first-start path is internally consistent and verifiable.

## Acceptance Criteria

1. pnpm test passes including @happytg/shared Windows home resolution cases
2. Codex detection handles Windows PATH/Path, PATHEXT, codex.cmd shims, and doctor/verify stop reporting false negatives when codex --version works
3. Bootstrap/onboarding explicitly handles Telegram bot token setup, invalid token guidance, and fast path to /pair without exposing secrets
4. Bootstrap/onboarding reports Redis absent/stopped/running states and explains the 6379 compose conflict path without unsafe auto-actions
5. Bootstrap/onboarding checks critical ports including 3001, 4000, 4100, 4200, 6379 and gives actionable override guidance including Windows PowerShell examples
6. README and install/quickstart/bootstrap docs reflect the new first-start flow and supported alternative port selection
7. Versioning is bumped using the existing repo scheme with a structured release summary aligned to actual scope

## Constraints

- Scope is strictly limited to install/bootstrap/onboarding/runtime-detection/docs/release-summary surfaces.
- Preserve AGENTS.md invariants: Telegram remains a surface, not internal transport; policy still precedes approval; higher-level policy cannot be weakened; host mutations stay serialized; heavy init remains lazy/cache-aware; hooks stay platform primitives.
- Do not introduce a broad refactor, new release mechanism, transport changes, or unrelated lint/test/tooling work.
- Do not weaken secret handling. Telegram token guidance may validate presence/obvious placeholder states, but must not print secrets into logs, raw artifacts, plain-text diagnostics, or release notes.
- Keep normal plain-text UX short and actionable; push detailed state into diagnostics and `--json` instead of verbose default output.
- Keep machine-readable bootstrap/report contracts stable unless a narrow additive change is required for this scope.
- Preserve Unix/macOS behavior while adding Windows-safe handling.
- Builder and verifier must be separate roles. Verifier must not edit production code. Any post-verify fix must be minimal and targeted.
- Proof bundle artifacts must be populated under `.agent/tasks/HTG-20260408-bootstrap-onboarding/` and completion requires evidence that acceptance criteria were met.

## Out of Scope

- Reworking overall control-plane architecture, transport, or daemon/API protocols beyond what is required for install/bootstrap/onboarding messaging.
- Adding “real” lint implementations where packages currently use `TODO: lint ...`.
- Automatic process killing, automatic Redis install/start/reinstall, automatic Docker reconfiguration, or any silent destructive port reassignment.
- Expanding into unrelated app features, UI redesign beyond onboarding clarity, or broader Telegram bot feature work.
- Publishing, tagging, or creating external releases beyond repo-local version/source updates and structured release notes that fit existing repo conventions.

## Verification Plan

- Init/freeze:
  - Ensure the canonical proof bundle exists and `spec.md` stays frozen before production edits.
- Build:
  - Implement only the scoped changes in shared/bootstrap/runtime-adapters/onboarding-related app surfaces/docs/version metadata.
  - Add regression tests for Windows home resolution, Windows-like Codex shim detection, Telegram onboarding/pairing messaging, Redis state detection, and port conflict rendering as applicable.
- Evidence:
  - Record command outputs in task-local raw artifacts:
    - `raw/lint.txt` for `pnpm lint`
    - `raw/build.txt` for `pnpm typecheck` and `pnpm build`
    - `raw/test-unit.txt` for `pnpm test`
    - `raw/test-integration.txt` for `pnpm happytg doctor` and `pnpm happytg verify`
  - Update `evidence.md` and `evidence.json` to map acceptance criteria to concrete files, tests, and verification commands.
- Fresh verify:
  - Independent verifier reviews frozen scope, changed files, proof artifacts, and reruns or inspects the required verification results before writing `problems.md` and `verdict.json`.
- Minimal fix:
  - If verifier reports findings, apply only the minimum required fix within the frozen scope, refresh evidence, and hand off again.
- Completion gates:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - `pnpm happytg doctor`
  - `pnpm happytg verify`
  - Docs reflect first-start commands, Telegram token setup, Redis states/conflicts, and Windows PowerShell port override examples.
  - Version/source metadata and structured release summary are consistent with the chosen semver bump.
