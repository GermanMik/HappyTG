# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Installer distinguishes Telegram token/config failures from lookup/network/secondary secret failures. | `packages/bootstrap/src/install/telegram.ts`; `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/install/types.ts`; `packages/bootstrap/src/cli.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/install.test.ts`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-unit.txt` |
| Windows Codex PATH diagnostics distinguish real missing Codex from recoverable PATH/shim issues without false cascade failure. | `packages/bootstrap/src/index.ts`; `packages/bootstrap/src/index.test.ts`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/runtime-adapters-test.txt`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/typecheck.txt` |
| Installer summary and post-check UX separate completed install from follow-up environment issues. | `packages/bootstrap/src/install/index.ts`; `packages/bootstrap/src/cli.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/index.ts`; `packages/bootstrap/src/index.test.ts`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-integration.txt` |

## Root Cause

1. `packages/bootstrap/src/install/telegram.ts` had only one secondary Telegram check: `https://api.telegram.org/bot<TOKEN>/getMe`. It returned a flat error string, so installer UX could not distinguish invalid-token rejection from transient fetch/network failure. There is no webhook or webhook-secret generation path in this installer flow, so that hypothesis did not match the code path.
2. `packages/bootstrap/src/install/index.ts` used the `getMe` result as the only source of bot identity. When `getMe` failed, the installer lost the already-known bot username for pair guidance even if `TELEGRAM_BOT_USERNAME` was already present, and warnings were too generic to explain what failed.
3. `packages/bootstrap/src/index.ts` diagnosed Codex only through direct `codex` resolution first. If the shell PATH did not yet expose Codex but the npm global wrapper existed and was runnable, bootstrap still surfaced a missing-Codex style failure cascade in installer post-checks instead of downgrading that to a PATH follow-up warning.
4. `packages/bootstrap/src/install/index.ts` also rebuilt the Windows PATH using `env.Path ?? env.PATH`, which can discard the usable path when one casing variant is empty. That makes post-check environments more fragile on Windows.

## Verification

- Passed:
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- Observed, expected local-environment findings:
  - `pnpm happytg doctor`
  - `pnpm happytg verify`

`doctor` and `verify` still report the current checkout as missing `.env`, `TELEGRAM_BOT_TOKEN`, and Redis. Those are local workspace findings in this environment, not regressions from the installer/bootstrap changes.

## Artifacts

- `packages/bootstrap/src/cli.ts`
- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/index.test.ts`
- `packages/bootstrap/src/install/index.ts`
- `packages/bootstrap/src/install/telegram.ts`
- `packages/bootstrap/src/install/types.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `packages/bootstrap/src/install.test.ts`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/runtime-adapters-test.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/build.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/doctor.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/verify.txt`
- `.agent/tasks/HTG-2026-04-13-windows-installer-telegram-codex-path/raw/bundle-validate.txt`
