# Task Spec

- Task ID: HTG-2026-04-19-installer-progress-bar
- Title: Add installer-wide progress bar
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

Interactive install currently renders only a step list. When a step like `Resolve planned ports` spends ~20 seconds checking or rerunning setup, the screen shows the active step label but gives no aggregate sense of how far through the install flow the user is. That makes legitimate long-running components look stalled even when the installer is still progressing normally.

## Acceptance Criteria

1. Interactive installer progress screen shows an aggregated step-count progress bar for the full install flow.
2. Completed progress counts only terminal steps (passed, warn, failed, skipped); running steps remain incomplete.
3. Long-running steps such as planned-port resolution visibly benefit from the shared progress bar without changing installer semantics.
4. Renderer and runtime regression coverage prove the bar appears during interactive install progress.

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Keep the existing step state machine and per-step semantics intact; add progress at the TUI render layer.
- ASCII-safe output only; avoid glyphs that degrade on Windows terminals.
- Out of scope: changing installer ordering, port-preflight behavior, or post-install automation semantics.

## Verification Plan

- Unit: `pnpm --filter @happytg/bootstrap test -- --test-name-pattern \"progress\"`
- Integration: targeted interactive installer runtime coverage in `packages/bootstrap/src/install.runtime.test.ts`
- Package: `pnpm --filter @happytg/bootstrap build`
- Bundle: `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-progress-bar`
