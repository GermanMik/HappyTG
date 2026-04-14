# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Bootstrap detects runnable Codex wrappers in standard Windows npm user bin locations even when npm prefix probing is unavailable. | `packages/bootstrap/src/index.ts`; `packages/bootstrap/src/index.test.ts`; `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/test-unit.txt` |
| Installer post-checks treat that state as PATH follow-up warning instead of recoverable failure. | `packages/bootstrap/src/install.runtime.test.ts`; `packages/bootstrap/src/index.ts`; `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/test-integration.txt` |
| Diagnostics remain actionable for truly missing Codex installs. | `packages/bootstrap/src/index.ts`; `packages/bootstrap/src/index.test.ts`; `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/test-unit.txt`; `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/typecheck.txt` |

## Root Cause

1. `packages/bootstrap/src/index.ts` only trusted wrapper paths derived from `npm prefix -g`.
2. On real Windows machines, Codex may still be runnable through the standard user shim under `%APPDATA%\\npm\\codex.cmd` even when `npm prefix -g` probing is unavailable in the current shell.
3. In that state bootstrap could not prove a PATH-follow-up condition, so installer post-checks surfaced the generic missing-Codex failure path instead of `CODEX_PATH_PENDING`.
4. Warning text also stayed too generic because diagnostics only knew about `npmBinDir` from prefix probing, not the actual recovered wrapper directory.

## Verification

- Passed:
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-13-windows-codex-appdata-wrapper`

## Artifacts

- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/index.test.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/test-integration.txt`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/build.txt`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/lint.txt`
- `.agent/tasks/HTG-2026-04-13-windows-codex-appdata-wrapper/raw/bundle-validate.txt`
