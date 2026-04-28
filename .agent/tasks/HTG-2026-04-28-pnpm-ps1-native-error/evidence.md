# Evidence

## Build/Fix Summary

- `scripts/install/install.ps1` now resolves pnpm through `Get-PnpmExecutable`, preferring `pnpm.cmd`, `pnpm.exe`, or another native application before falling back to the PowerShell shim.
- Captured pnpm bootstrap calls run through `Invoke-PnpmCaptured`, which temporarily uses `$ErrorActionPreference = "Continue"` while still returning an explicit exit code.
- Final shared-installer handoff runs through `Invoke-PnpmPassthrough`, then checks `$LASTEXITCODE` explicitly so native stderr does not become a false terminating PowerShell error.
- `packages/bootstrap/src/install.scripts.test.ts` adds a regression where `pnpm.ps1` is present and fails with `NativeCommandError`-style output, while `pnpm.cmd` succeeds.

## Verification

- Passed: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.scripts.test.ts`
  - Raw log: `.agent/tasks/HTG-2026-04-28-pnpm-ps1-native-error/raw/test-install-scripts.txt`
- Passed: `pnpm --filter @happytg/bootstrap run typecheck`
  - Raw log: `.agent/tasks/HTG-2026-04-28-pnpm-ps1-native-error/raw/typecheck-bootstrap.txt`
- Passed: `pnpm --filter @happytg/bootstrap run test`
  - Raw log: `.agent/tasks/HTG-2026-04-28-pnpm-ps1-native-error/raw/test-bootstrap.txt`
