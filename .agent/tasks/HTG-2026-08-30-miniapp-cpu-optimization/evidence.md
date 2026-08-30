# Evidence Bundle: HTG-2026-08-30-miniapp-cpu-optimization

## Summary
- Overall status: PASS
- Last updated: 2026-08-30

## Acceptance criteria evidence

### AC1
- Status: PASS
- Proof:
  - `apps/miniapp/src/index.ts` renders the mobile sticky `.topbar` with `background: var(--surface)`, `-webkit-backdrop-filter: none`, and `backdrop-filter: none`.
  - Real-browser smoke computed `backdrop-filter: none` and opaque `rgb(255, 255, 255)`. See `raw/test-integration.txt`.
- Gaps: none.

### AC2
- Status: PASS
- Proof:
  - `defaultDesktopSessionLimit` is 20; project-filtered non-CLI views still request 100.
  - Unit tests assert broad `limit=20`, project `limit=100`, and the five-card project cap. See `raw/test-unit.txt`.
- Gaps: none.

### AC3
- Status: PASS
- Proof:
  - `nextDesktopSessionLimit` stages 20 -> 50 -> 100 -> 200; request parsing clamps explicit limits to 20..200.
  - Focused route coverage verifies default, expanded, lower-bound, and upper-bound requests; browser smoke verified the live `limit=50` link.
- Gaps: none.

### AC4
- Status: PASS
- Proof:
  - `.session-card` uses `content-visibility: auto` and `contain-intrinsic-size: auto 180px`; card markup and controls remain unchanged.
  - Browser computed both properties and exposed 20 rendered session cards. See `raw/test-integration.txt`.
- Gaps: none.

### AC5
- Status: PASS
- Proof:
  - `pnpm --filter @happytg/miniapp test`: 28/28 pass.
  - `pnpm --filter @happytg/miniapp typecheck`: exit 0.
  - `pnpm --filter @happytg/miniapp lint`: exit 0.
  - `pnpm --filter @happytg/miniapp build`: exit 0.
  - `git diff --check`: exit 0.
  - Browser proof reduced the broad page from 1758 to 870 DOM elements and verified computed styles.
- Gaps: none.

## Changed implementation files
- `apps/miniapp/src/index.ts`
- `apps/miniapp/src/index.test.ts`

## Workflow artifacts
- `.agent/tasks/HTG-2026-08-30-miniapp-cpu-optimization/`
- ProofLoop-managed project agent templates and guide blocks refreshed by `init`.

## Commands run
- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/miniapp typecheck`
- `pnpm --filter @happytg/miniapp lint`
- `pnpm --filter @happytg/miniapp build`
- `git diff --check`
- isolated real-browser smoke on port 3011

## Raw artifacts
- `.agent/tasks/HTG-2026-08-30-miniapp-cpu-optimization/raw/build.txt`
- `.agent/tasks/HTG-2026-08-30-miniapp-cpu-optimization/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-08-30-miniapp-cpu-optimization/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-08-30-miniapp-cpu-optimization/raw/lint.txt`

## Known gaps
- Exact Telegram WebView renderer flamegraph attribution remains out of scope; browser proof demonstrates the requested rendering-cost reductions and computed properties.
