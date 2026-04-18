# Task Spec

- Task ID: HTG-2026-04-18-installer-port-conflict-tui-hang
- Title: Fix installer port conflict TUI hang on confirm
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

Interactive `pnpm happytg install` can stall on the `Port Conflict` decision step during planned-port preflight. The UI renders the real Mini App conflict correctly, but the user cannot reliably complete the prompt and continue through suggested-port selection, manual entry, or abort.

## Acceptance Criteria

1. Choosing a suggested port completes the prompt, writes the selected `HAPPYTG_*_PORT` override into the existing installer `.env` path, reruns preflight, and continues the install flow.
2. Choosing `Enter custom port` accepts a valid port, rejects invalid input with a product-level validation message, and continues without hanging.
3. Choosing `Abort install` exits the step predictably without hidden config changes or hangs.
4. Supported reuse behavior remains unchanged and does not trigger pointless port rebinding.
5. Deterministic regression coverage exercises the interactive path for suggested-port, manual-port, abort, and prompt completion so the hang is caught in tests.

## Constraints

- Preserve honest preflight before services start.
- No hidden auto-rebind and no default-port changes without explicit user choice.
- Keep explicit env override precedence and current UX copy unless a change is required for the fix.
- Minimize churn outside installer/TUI key handling and directly related tests.

## Verification Plan

- Unit/runtime: `pnpm --filter @happytg/bootstrap test -- --test-name-pattern "port preflight|promptSelect|promptPortValue|waitForEnter"`
- Integration: targeted interactive installer runtime tests in `packages/bootstrap/src/install.runtime.test.ts`.
- Evidence files: raw build/lint/test-unit/test-integration plus synchronized evidence/verdict summaries.
