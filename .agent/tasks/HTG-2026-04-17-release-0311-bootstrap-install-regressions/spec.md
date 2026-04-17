# Task Spec

- Task ID: HTG-2026-04-17-release-0311-bootstrap-install-regressions
- Title: Release 0.3.11 bootstrap/install regressions
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

HappyTG `0.3.11` regressed in three connected areas:

1. Windows bootstrap can be poisoned by a stale external `NODE_OPTIONS=--require ...` preload path and then falsely reports `Node.js 22+ is still not available on PATH` even when Node is installed.
2. Installer warning surfaces and final summary need truthful classification for Telegram `getMe`, Codex websocket `403` fallback, and Mini App port `3001` conflicts without hiding real environment problems.
3. The interactive installer TUI regressed so the active/running step no longer renders a stable readable indicator; the user reports a purple `E` where the active marker used to be.

## Acceptance Criteria

1. Broken preload path no longer collapses into the misleading `Node.js 22+ is still not available on PATH` message when Node is present.
2. Root cause is classified explicitly as external environment contamination vs repo-managed preload requirement.
3. If preload is actually required, it is created inside a HappyTG-managed bootstrap/workspace location before first `node` use; if it is not required, bootstrap tolerates stale external preload paths without hiding real failures.
4. `install.ps1` and `install.sh` both use the same truthful bootstrap classification strategy rather than a Windows-only band-aid.
5. Installer warning surfaces remain truthful:
   - Telegram `getMe`
   - Codex websocket `403 Forbidden`
   - Mini App `3001` busy
   - Final Summary / Next steps wording
6. Legitimate environment warnings remain visible, but final output is concise, deduped, and non-contradictory.
7. TUI step indicators are readable again; running/completed/warn/error states no longer degrade into a purple `E` or unstable glyph/color combinations.
8. Regression coverage exists for bootstrap poisoning, warning/final-summary behavior, and TUI indicator rendering, or any uncovered interactive boundary is explicitly justified in the evidence.
9. Proof bundle is complete and passes a fresh verifier review.

## Constraints

- Use repo-local evidence and proof-first flow.
- Keep the fix minimal and do not hide real environment warnings for the sake of a green summary.
- Do not assume that creating an `undici` preload inside HappyTG is the answer unless evidence proves HappyTG truly owns that preload.
- Preserve prior installer summary/warning improvements; do not regress existing dedupe or wording work.

## Out Of Scope

- Unrelated installer refactors.
- Suppressing real Telegram/Codex/port warnings that are caused by the local machine or external services.
- Adding a new user-selected preload directory variable unless evidence first proves `HAPPYTG_BOOTSTRAP_DIR` is insufficient.
- Non-installer runtime changes outside bootstrap wrappers, warning wording, and TUI step rendering.

## Verification Plan

- Reproduce clean and poisoned bootstrap behavior on Windows PowerShell with a missing external preload path.
- Add wrapper-script regression tests for `install.ps1` and `install.sh`.
- Add a TUI renderer regression test for the running-step indicator.
- Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0311-bootstrap-install-regressions`.
- Record repo-local artifacts under `raw/`, then obtain a fresh verifier pass from a separate role.
