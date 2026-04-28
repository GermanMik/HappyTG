# Task Spec

- Task ID: HTG-2026-04-19-uninstall-multi-artifact-cleanup
- Title: Bootstrap uninstall multi-artifact cleanup
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG bootstrap currently has install/setup/doctor/verify/status flows, but no uninstall command even though the installer can create local daemon state, install reports, a bootstrap checkout, and background launchers. The uninstall flow must be safe by default and also truthful when install was run repeatedly with different background modes, especially on Windows where a host may end up with both the `HappyTG Host Daemon` Scheduled Task and the Startup shortcut. A naive single-last-mode state model would only remember the latest launcher artifact and leave older recorded launcher surfaces behind, or over-delete unrelated global launchers.

## Acceptance Criteria

1. Repeated installs with different background modes keep enough ownership metadata for truthful uninstall cleanup.
2. Uninstall removes all recorded launcher artifacts for the current local state scope without deleting unowned global launchers.
3. Windows regressions cover scheduled-task plus startup leftovers across repeated installs and docs stay truthful.

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Safe by default: do not delete the repo checkout, `.env`, Docker services/volumes, remote control-plane data, or unowned global launcher artifacts by default.
- Keep churn bounded to bootstrap CLI/install/uninstall surfaces, tests, docs, and the proof bundle.
- Prefer recording multiple owned background artifacts in install state over broad fallback deletion heuristics.
- Out of scope: destructive repo removal, remote control-plane cleanup, or a hard-delete mode.

## Verification Plan

- Unit: extend bootstrap CLI tests for uninstall parsing/execution/rendering and add uninstall runtime tests for repeated background-mode ownership cleanup.
- Unit: cover Windows repeated-install ownership where both scheduled-task and startup artifacts are present for the same local state scope.
- Manual: record `pnpm --filter @happytg/bootstrap test`, `pnpm --filter @happytg/bootstrap build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm happytg doctor`, `pnpm happytg verify`, and `pnpm happytg task validate --repo . --task HTG-2026-04-19-uninstall-multi-artifact-cleanup` in the proof bundle.
