# HTG-2026-04-28-pnpm-ps1-native-error

Phase: complete

## Scope

Fix the Windows bootstrap installer path where `scripts/install/install.ps1` invokes the PowerShell `pnpm.ps1` shim and `node.exe` progress output is promoted to `NativeCommandError` under `$ErrorActionPreference = "Stop"`.

## Acceptance Criteria

- `install.ps1` must prefer a native pnpm executable/shim (`pnpm.cmd`, `pnpm.exe`, or extensionless application) over `pnpm.ps1` for bootstrap preflight and shared-installer handoff.
- The ignored-build-scripts warning normalization behavior must remain intact.
- A regression test must cover a PATH containing both `pnpm.ps1` and `pnpm.cmd`, where the PowerShell shim fails with `NativeCommandError`-style output but the native command succeeds.
- Focused bootstrap installer tests must pass.

## Out Of Scope

- Changing repository pnpm policy or auto-approving build scripts.
- Changing the POSIX shell installer.
- Publishing a release.
