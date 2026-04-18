# Evidence

## Root cause

`packages/bootstrap/src/install/tui.ts` used inconsistent confirm-key semantics across interactive prompts:

- `waitForEnter()` already treated confirm as `return`, `enter`, `\r`, or `\n`;
- `promptSelect()`, `promptMultiSelect()`, `promptPortValue()`, and `reduceTelegramFormKeypress()` only completed on `key.name === "return"` in their confirm branches.

That mismatch left the new port-conflict flow vulnerable to a terminal/keypress variant where `Enter` is reported as `enter` or plain carriage return. In that case the menu kept redrawing, but the prompt never resolved, so suggested-port selection, manual entry confirm, and abort looked like a hang.

## Fix

- Reused the shared confirm-key predicate across all interactive installer prompts.
- Kept port-preflight product semantics unchanged: no auto-rebind, no change to supported reuse, same override path, same 3 suggested ports, same abort semantics.
- Added deterministic regression coverage that drives the interactive port-conflict flow with `enter`, not just `return`, including invalid-manual-entry recovery.

## Verification

- `pnpm --filter @happytg/bootstrap run build`
- `pnpm --filter @happytg/bootstrap run lint`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run test`
- `pnpm --filter @happytg/bootstrap exec tsx --test --test-name-pattern "promptSelect|promptPortValue|port preflight|waitForEnter" src/install.test.ts src/install.runtime.test.ts`

## Result

All verification commands passed. The targeted interactive suite now covers:

- suggested port selection with `enter`;
- manual port entry with `enter`;
- invalid manual port validation without hang;
- abort with `enter`;
- prompt-level completion for single-select and custom-port entry.
