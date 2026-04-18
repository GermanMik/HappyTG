# Task Spec

- Task ID: HTG-2026-04-18-installer-port-preflight-progress-indicator
- Title: Add installer progress indicator during port preflight rerun
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

After the user confirms a port-conflict choice in interactive install, the prompt closes and the installer silently saves the override plus reruns planned-port preflight. Even when the flow is working, that pause can look like another hang because the last visible screen is the old port-conflict prompt.

## Acceptance Criteria

1. After suggested-port or manual-port confirmation, interactive install shows a clear in-progress state while saving the selected override and rerunning planned-port preflight.
2. The new indicator uses the existing installer progress surface rather than introducing a separate ad-hoc UI.
3. Port-preflight product semantics remain unchanged: same override target, same preflight rerun, same supported reuse/conflict behavior, no hidden auto-rebind.
4. Deterministic regression coverage proves the intermediate progress state is visible before the rerun completes.

## Constraints

- Minimal churn limited to installer/TUI progress orchestration and directly related tests.
- Keep existing UX copy unless a change is needed to explain the in-progress state.
- Do not alter default ports, env precedence, or conflict-resolution outcomes.

## Verification Plan

- Unit/runtime: targeted bootstrap tests covering the visible progress state during interactive port-preflight rerun.
- Package verification: `pnpm --filter @happytg/bootstrap run build`, `typecheck`, and targeted tests.
