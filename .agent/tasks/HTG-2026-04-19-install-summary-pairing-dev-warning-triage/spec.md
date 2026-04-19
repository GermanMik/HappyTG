# HTG-2026-04-19-install-summary-pairing-dev-warning-triage

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-19
- Coordinator: Codex main agent
- Builder role: `task-builder`
- Verifier role: `task-verifier`
- Fixer role (only if verifier finds scoped issues): `task-fixer`

## Goal

Classify and, only where current repo-local evidence proves a real product issue, minimally fix the install-summary pairing path, the dev/reuse path around an already-running API, and the surrounding diagnostic noise so the output is truthful, state-machine-correct, and independently verified.

## Required Discipline Sources

- `repo-task-proof-loop`
- `Quick Start / verify docs`
- `Вскрываем исходники Claude Code`

These sources govern method and discipline only. The source of truth for conclusions remains the current repository code, live reproduction, and artifacts written under this task bundle.

## In Scope

### 1. Codex websocket `403 Forbidden`

- Trace the current `setup` / `doctor` / `verify` / install-summary code path that classifies Codex smoke stderr.
- Reproduce the warning on the current machine and preserve raw output in the bundle.
- Classify the issue as exactly one of:
  - `product bug`
  - `false positive`
  - `misleading UX / wrong severity`
  - `legitimate environment warning`
  - `external dependency issue`
- Prove whether the warning is blocking or whether the CLI falls back to HTTP successfully.
- If current wording/severity is misleading in the product, implement the minimum scoped fix and add regression coverage.

### 2. `/pair CODE` after install summary

- Model the install and pairing handoff as a state machine rather than isolated messages.
- Prove the real execution path from installer final summary to daemon pairing request to Telegram `/pair CODE` claim.
- Determine whether the reported broken `/pair CODE` path is:
  - a current product bug,
  - a stale/already-fixed report,
  - a misleading summary that promises an unreachable state,
  - or an external/runtime precondition failure.
- If a current product bug or misleading summary is proven, implement the minimum scoped fix and lock it with regression coverage.

### 3. Dev/reuse path and already-running API interaction

- Trace the fast path for `pnpm dev`, API startup, and any installer/setup summary text that talks about reuse.
- Prove how the current code distinguishes:
  - HappyTG API already running on the planned port,
  - another HappyTG service on that port,
  - a foreign process on that port,
  - transient handoff during startup.
- Determine whether the user-visible symptom is a real product bug, a stale/already-fixed report, or truthful reuse/conflict behavior.
- If current product behavior is wrong or misleading, apply the minimum scoped fix and add regression coverage.

### 4. Turborepo update notice

- Reproduce the current Turbo update notice if it appears during task commands.
- Determine whether it is causally related to the pairing/dev/reuse symptoms or merely concurrent noise.
- Keep it visible if it is a legitimate external tool notice, but do not let it be misclassified as the product root cause.

### 5. Proof bundle closure

- Keep the canonical repo-local proof bundle synchronized:
  - `spec.md`
  - `evidence.md`
  - `evidence.json`
  - `problems.md`
  - `verdict.json`
  - `raw/*`
- Completion is allowed only after fresh verification and synchronized task metadata.

## State Machine To Validate

### Install and pairing flow

Input states:
- `telegram-blocked`
- `pairing-required-no-local-host`
- `pairing-required-existing-host`
- `already-paired`
- `api-unreachable`

Transitions to validate:
- installer post-check summary -> pairing decision state
- pairing decision state -> auto-requested code, reuse, or manual fallback
- pairing handoff message -> actual Telegram `/pair CODE` claim boundary
- pairing completion -> daemon start guidance

Blocking prerequisites:
- valid Telegram bot token
- reachable HappyTG API when automatic pairing refresh/request is claimed
- a real pairing code produced by the execution host before the user can claim it in Telegram

Terminal states:
- `reused-existing-host`
- `manual-pairing-required`
- `pairing-blocked`
- `ready-to-start-daemon`

The summary must not promise a terminal state that the user cannot actually reach from the current prerequisites.

### Dev/startup flow

Input states:
- `api-port-free`
- `api-port-held-by-happytg-api`
- `api-port-held-by-other-happytg-service`
- `api-port-held-by-foreign-process`
- `api-transient-handoff`

Transitions to validate:
- entrypoint invocation -> startup probe path
- startup probe path -> listen / reuse / conflict classification
- classification -> user-visible summary and next command

## Out Of Scope

- Release/publish work
- unrelated refactors
- hiding legitimate environment warnings to make output look green
- changing Telegram claim semantics beyond the minimum needed to keep messaging truthful
- heavy startup refactors unless a fast-path root cause proves they are necessary

## Constraints

- Read-only exploration can be parallelized in bounded fan-out.
- All writes, production edits, and proof-bundle updates must be serialized.
- Do not build before spec freeze.
- Builder and verifier must stay separate.
- Verifier must not edit production code.
- Any fix after verifier findings must be minimal and inside this frozen scope.
- Live artifacts must be resumable by a future agent without oral context.

## Acceptance Criteria

1. The task bundle contains repo-local evidence that separately classifies:
   - Codex websocket `403` warning
   - `/pair CODE` after install summary
   - dev/reuse path versus already-running API
   - Turbo update notice
2. Each classified issue has an explicit root cause statement grounded in current code paths and current reproduction artifacts, not only prior task history.
3. Any implemented code change is limited to a proven current product bug or misleading UX/wrong severity within this scope.
4. Regression coverage exists for each product behavior changed in code, or the evidence bundle explains why deterministic coverage is not practical.
5. `evidence.md`, `evidence.json`, `problems.md`, `verdict.json`, and `raw/*` are synchronized with the final verifier outcome.
6. A fresh verifier pass runs after the builder work; if findings appear, only a minimal scoped fix is applied, followed by another fresh verifier pass.
7. Completion happens only when `pnpm happytg task validate --repo . --task HTG-2026-04-19-install-summary-pairing-dev-warning-triage` reflects the finalized bundle state.

## Verification Plan

Baseline reproduction artifacts:
- `pnpm happytg install --json`
- `pnpm happytg setup --json`
- `pnpm happytg doctor --json`
- `pnpm happytg verify --json`
- targeted `pnpm dev` / API startup reproduction when needed

Workspace verification:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Targeted checks:
- focused bootstrap/runtime-adapters/API tests for any changed code path
- task bundle status/validate commands

Required raw artifacts:
- `raw/build.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/install-json.txt`
- `raw/setup-json.txt`
- `raw/doctor-json.txt`
- `raw/verify-json.txt`
- `raw/dev-api.txt`
- `raw/codex-smoke.txt`
- `raw/task-status.txt`
- `raw/task-validate.txt`
