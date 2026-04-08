# Task Spec

- Task ID: HTG-2026-04-08-first-run-win
- Title: Windows first-run UX and diagnostics hardening
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

Windows first-run behavior is currently brittle and noisy. `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass, but `pnpm test` fails in `@happytg/runtime-adapters` and `@happytg/bootstrap` because the test harness and some runtime checks assume Unix-only behavior. In parallel, normal first-run UX is too verbose and exposes low-level errors directly: `miniapp` crashes on port `3001` conflicts with an unhandled `EADDRINUSE`, `host-daemon` repeats `spawn codex ENOENT` and unpaired-host errors in a loop, and bootstrap readiness surfaces raw details instead of short next steps.

This task fixes first-run reliability and onboarding/diagnostics UX for Windows while preserving macOS/Linux behavior and preserving machine-readable JSON outputs.

## Acceptance Criteria

1. Runtime adapters use a cross-platform Codex harness and package tests pass on Windows/macOS/Linux without POSIX-only test scripts.
2. Bootstrap reports missing config and Codex smoke warnings as warn, uses PATH-based Git detection, and preserves machine-readable report JSON.
3. User-facing first-run messaging is concise and actionable for missing Codex CLI, unpaired host, and occupied miniapp port; verbose details stay in doctor/JSON diagnostics.
4. CLI bootstrap output is structured and compact, and at least one user-facing progress indicator is shown without changing existing APIs unnecessarily.
5. Miniapp handles port conflicts without an unhandled stack trace and host-daemon suppresses repeated expected first-run noise.
6. Tests cover the cross-platform runtime harness, bootstrap warning expectations, diagnostics/text rendering split, and reduced-noise startup or miniapp port-conflict handling.

## Constraints

- Runtime: Codex CLI remains the primary runtime; production code must continue to work with an installed Codex CLI on Windows, macOS, and Linux.
- Machine-readable bootstrap JSON and existing API routes/contracts should not change unless strictly required for correctness.
- Architectural invariants from `AGENTS.md` remain intact: no transport changes, no weakening of policy/approval ordering, no mutation outside the serialized host flow.
- Normal first-run surfaces should stay short and user-facing; low-level stderr, stack traces, binary paths, config paths, and raw smoke output belong in `doctor` and/or `--json`.
- `shell: true` must not be enabled globally just to make Windows spawning work; prefer a cross-platform executable harness using Node and `process.execPath` for tests.
- Out of scope:
- unrelated lint TODOs
- `esbuild` warnings unless proven causal
- transport or orchestration redesign
- auto-selecting a new miniapp port if that risks current architecture
- broad visual redesign outside existing project style

## Verification Plan

- Unit:
- `pnpm --filter @happytg/runtime-adapters test`
- `pnpm --filter @happytg/bootstrap test`
- targeted tests for `@happytg/miniapp`, `@happytg/host-daemon`, and `@happytg/shared` if helpers move there
- Integration:
- `pnpm test`
- `pnpm happytg doctor`
- Manual:
- confirm miniapp exits with an actionable message on port conflict instead of an unhandled stack trace
- confirm host-daemon emits short first-run guidance and suppresses repeated identical missing-Codex/unpaired-host noise
- confirm non-JSON CLI output is structured with summary, sections, statuses, and next steps
- Evidence files to produce:
- `.agent/tasks/HTG-2026-04-08-first-run-win/raw/build.txt`
- `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-08-first-run-win/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-08-first-run-win/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-08-first-run-win/evidence.md`
- `.agent/tasks/HTG-2026-04-08-first-run-win/evidence.json`
- `.agent/tasks/HTG-2026-04-08-first-run-win/problems.md`
- `.agent/tasks/HTG-2026-04-08-first-run-win/verdict.json`
