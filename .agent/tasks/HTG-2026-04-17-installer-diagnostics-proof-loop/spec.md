# HTG-2026-04-17-installer-diagnostics-proof-loop

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-17
- Coordinator: Codex main agent
- Builder role: `task-builder`
- Verifier role: `task-verifier`
- Fixer role (only if verifier finds scoped issues): `task-fixer`

## Goal

Fix or correctly reclassify HappyTG installer/setup/doctor/verify warnings around Telegram `getMe`, Codex wrapper/PATH/smoke-check, and port diagnostics without masking real environment problems. Add proactive planned-port analysis and keep final summaries deduplicated, accurate, and actionable.

## In Scope

### 1. Telegram `getMe` / fetch diagnostics

- Find where Telegram bot validation and `getMe` warnings are produced.
- Reproduce or simulate the currently reported `fetch failed` path.
- Distinguish missing token, invalid token, network failure, TLS/proxy/fetch failure, Bot API unavailability, and diagnostic bugs where possible.
- Improve classification, wording, severity, and actionable guidance without hiding real failures.
- Add regression coverage for the root cause(s) actually fixed.

### 2. Codex wrapper / PATH / smoke-check diagnostics

- Find where Codex CLI detection, npm wrapper detection, PATH checks, and smoke checks are implemented.
- Explain why the product can report that the npm wrapper works while still emitting repeated PATH warnings and a smoke-check warning.
- Fix root cause where safe, including child-process PATH self-heal if appropriate.
- Otherwise improve classification, dedupe, wording, and contradiction handling so setup/doctor/verify and final summary stay coherent.
- Add regression coverage for the fixed behavior.

### 3. Occupied ports diagnostics / severity / reuse behavior

- Find current occupied-port detection and summary generation.
- Distinguish supported reuse of an already running HappyTG or expected local dependency from a third-party conflict.
- Improve listener attribution, severity, wording, and actionable next steps.
- Avoid suppressing legitimate conflicts.

### 4. Planned ports analysis / process attribution / alternatives

- Determine the source of truth for all ports HappyTG plans to use in the current configuration before service startup.
- Add proactive analysis for each planned port: planned component, current listener/process attribution, classification, and safe alternative ports.
- Ensure installer/bootstrap/final summary can present concise but complete planned-port diagnostics.
- If exact attribution is unavailable on the platform, report that explicitly while still producing best-effort actionable output.

### 5. Final summary dedupe / contradiction cleanup

- Remove duplicate warnings across setup/doctor/verify/final summary.
- Keep only truthful warnings in the final summary.
- Ensure severity and wording match the actual state and do not contradict earlier diagnostics.

### 6. Publish flow after successful verify

- After successful fresh verify, perform commit, push, PR, merge, and release decision flow if scope warrants it and repo metadata supports it.
- Keep git history minimal and aligned with this frozen scope.

## Out of Scope

- Unrelated refactors outside installer/bootstrap diagnostics.
- Changes to runtime behavior outside the minimum needed to support truthful diagnostics.
- Broad release metadata cleanup unless required by this scoped fix.
- Silencing real environment warnings without better classification or guidance.
- Unsupported automation of external environment remediation on the user's machine.

## Constraints

- Read-only exploration may be parallelized.
- Production edits and other mutations must remain serialized.
- Builder and verifier must be separate roles.
- Verifier must not edit production code.
- Any post-verify production change must be minimal and scoped.

## Acceptance Criteria

1. Telegram diagnostics no longer collapse actionable failures into an overly generic `fetch failed` message when a more precise safe classification is available.
2. Codex wrapper/PATH/smoke-check diagnostics do not report a contradictory repeated state when the npm wrapper is usable.
3. Port diagnostics distinguish supported reuse from real conflicts and remain actionable.
4. Planned-port analysis is proactive, component-aware, and included in concise final reporting.
5. Final summary is deduplicated, truthful, and severity-correct.
6. Regression coverage exists for root causes fixed by the code change.
7. Publish flow is completed only after a successful fresh verifier pass.

## Evidence Plan

- Baseline reproductions for `pnpm happytg setup --json`, `pnpm happytg doctor --json`, `pnpm happytg verify --json`.
- Workspace verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Targeted regression tests for Telegram/Codex/port diagnostics.
- Proof bundle artifacts in this directory.
