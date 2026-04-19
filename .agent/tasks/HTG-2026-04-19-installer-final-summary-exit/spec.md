# Task Spec

- Task ID: HTG-2026-04-19-installer-final-summary-exit
- Title: Make installer final pairing summary and close behavior product-honest
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

`pnpm happytg install` still exhibits two user-visible regressions in the live interactive path:

1. final pairing/task-completion guidance can render stale or contradictory summary items after post-checks, even though the installer now has backend-probed pairing logic;
2. the final summary screen can stay on `ENTER close` without returning the shell prompt, so the install process looks hung after completion.

## Root Cause Hypotheses

1. `packages/bootstrap/src/install/index.ts` rewrites pairing guidance for successful reuse/refresh branches, but the manual-fallback branch still preserves bootstrap post-check placeholder pairing items and can therefore surface stale or contradictory finalization output.
2. Current regression coverage proves `waitForEnter()` resolves in isolated stream tests, but it does not verify the live interactive exit path where stdin/raw-mode cleanup must also let the process terminate cleanly.
3. `packages/bootstrap/src/install/tui.ts` likely leaves the interactive stdin stream in a live state after the final screen closes, which would explain why Enter appears to do nothing and the shell prompt never returns.

## Architecture Decision

- Keep installer pairing orchestration in `packages/bootstrap/src/install/pairing.ts` and final-summary shaping in `packages/bootstrap/src/install/index.ts`.
- Keep Telegram `/pair <CODE>` as the only claim boundary; installer automation may probe state or request/refresh a code, but it must not silently claim the host.
- For summary output, prefer a single truthful finalization model over preserving bootstrap placeholder items when the installer already knows the actual pairing outcome.
- Fix final-screen exit at the shared TUI input-loop layer rather than with an install-specific workaround.

## Acceptance Criteria

1. Live installer finalization no longer shows contradictory manual pairing fallback when a host can already be truthfully classified as reused or auto-refreshed.
2. Existing paired or active hosts render a reuse-only summary with no manual `pnpm daemon:pair` step.
3. Existing unpaired/registering hosts render auto-refresh guidance with a concrete `/pair CODE` handoff when prerequisites are ready.
4. Probe/request failures remain honest and actionable, with blocked/manual fallback only when automation truly cannot proceed safely.
5. Final summary closes on Enter.
6. After the final summary closes, the installer process exits and returns the shell prompt.
7. Deterministic regression coverage exists for:
   - existing-host reuse/refresh/manual-fallback finalization branches;
   - final-screen close on Enter;
   - no unresolved interactive wait path after the final summary.

## Constraints

- No auth or security weakening.
- No hidden pairing bypass.
- Keep unrelated churn out of scope.
- Preserve existing installer flow and summary surfaces where possible.
- Serialize production writes after spec freeze.

## Verification Plan

- `pnpm --filter @happytg/bootstrap run build`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run test`
- Targeted installer runtime/TUI/CLI regression tests for pairing finalization and final-screen exit
- Fresh independent verifier pass after build/test evidence is collected
