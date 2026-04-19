# HTG-2026-04-19-pnpm-build-script-warning-guard

## Root Cause

- The repository pins `pnpm@10.0.0` in the root `package.json`, but the installer runtime previously resolved `pnpm` from PATH and treated `pnpm install` exit code `0` as unconditional success.
- `packages/bootstrap/src/install/index.ts` did not inspect success-path stdout/stderr, so an ignored-build-scripts warning could not affect installer status, next steps, or failure handling.
- The repo does rely on `tsx` for bootstrap/runtime commands, and `tsx` depends on `esbuild`, but repo-local repro with `only-built-dependencies=` proved that the warning alone does not automatically mean a broken install on the current pinned runtime.
- The live product bug was therefore not "esbuild is always broken"; it was "installer had no deterministic boundary between harmless policy noise, degraded state, and false success."
- A second boundary existed before the TUI: the shell shims handed off with raw `pnpm dlx tsx ...`, so any bootstrap-time ignored-build-scripts warning could surface as unmanaged noise outside installer UX.

## Manual Reproduction Before Fix

- `raw/pnpm-runtime-capability.txt`
  - `pnpm --version` -> `10.0.0`
  - `pnpm help approve-builds` -> `No results for "approve-builds"`
- `raw/ignored-build-scripts-healthy-repro.txt`
  - minimal repro with `.npmrc` `only-built-dependencies=`
  - `pnpm install` emits `The following dependencies have build scripts that were ignored: esbuild`
  - `pnpm exec tsx --eval ...` -> `HTG_PNPM_TOOLCHAIN_OK:1`
  - nested `esbuild` API build -> `HTG_ESBUILD_OK`
- `raw/bootstrap-dlx-pinned-runtime.txt`
  - pinned-runtime `pnpm dlx tsx --version` and `pnpm --silent dlx tsx --version` both run cleanly in the current repro

## Implementation

- `packages/bootstrap/src/install/index.ts`
  - parses ignored-build-scripts warnings from successful `pnpm install` output;
  - probes runtime pnpm capabilities with `pnpm --version` and `pnpm help approve-builds`;
  - runs a repo-local `pnpm exec tsx --eval ...` health check that exercises the critical `tsx` + `esbuild` bootstrap path;
  - classifies warning+healthy as warning-only continuation;
  - classifies warning+broken as recoverable install failure with version-aware guidance;
  - records the assessment in `reportJson.pnpmInstall` and final installer warning/finalization surfaces.
- `scripts/install/install.ps1` and `scripts/install/install.sh`
  - run a bootstrap `pnpm dlx tsx --eval ...` preflight first;
  - capture and classify ignored-build-scripts noise before TUI handoff;
  - hand off with `pnpm --silent dlx ...` so the bootstrap warning does not reappear as raw unmanaged output.
- `packages/bootstrap/src/install.runtime.test.ts`
  - added deterministic regressions for:
    - ignored-build-scripts warning + healthy toolchain;
    - ignored-build-scripts warning + broken toolchain;
    - no-warning path unchanged;
    - version-aware `approve-builds` guidance.
- `packages/bootstrap/src/install.scripts.test.ts`
  - added a wrapper regression proving PowerShell bootstrap warning normalization before shared-installer handoff.
- `docs/installation.md`
  - documents the new boundary: warning-only continuation vs explicit failure after toolchain validation.
- `docs/troubleshooting.md`
  - documents how to interpret the new ignored-build-scripts installer outcome.

## Verification

- `pnpm --filter @happytg/bootstrap run typecheck` -> pass (`raw/typecheck.txt`)
- `pnpm --filter @happytg/bootstrap run test` -> pass (`raw/test-unit.txt`)
- `pnpm --filter @happytg/bootstrap run build` -> pass (`raw/build-bootstrap.txt`)
- `pnpm lint` -> pass (`raw/lint.txt`)
- `pnpm test` -> pass (`raw/test-integration.txt`)
- `pnpm build` -> pass (`raw/build.txt`)
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-pnpm-build-script-warning-guard` -> `Validation: ok` (`raw/task-validate.txt`)

## Acceptance Criteria Mapping

1. Installer classifies ignored build script warnings deterministically instead of treating exit 0 as unconditional success.
   - Code: `packages/bootstrap/src/install/index.ts`
   - Proof: `raw/test-unit.txt`, especially:
     - `runHappyTGInstall classifies ignored build scripts as warning-only when the critical tsx/esbuild path stays healthy`
     - `runHappyTGInstall fails honestly when ignored build scripts leave the critical tsx/esbuild path broken`
2. Installer distinguishes warning-only healthy tsx/esbuild state from broken toolchain state with a repo-local post-install health check.
   - Code: `packages/bootstrap/src/install/index.ts`
   - Proof: `raw/ignored-build-scripts-healthy-repro.txt`, `raw/test-unit.txt`
3. Installer guidance is based on the runtime pnpm capabilities used in the flow and never suggests unsupported commands.
   - Proof: `raw/pnpm-runtime-capability.txt`, `raw/test-unit.txt`
   - Code: `packages/bootstrap/src/install/index.ts`
4. Launcher/install flow no longer leaves raw ignored-build-script warning noise unsynchronized with installer UX when the warning is reproducible in the current code path.
   - Code: `scripts/install/install.ps1`, `scripts/install/install.sh`
   - Proof: `raw/test-unit.txt`, especially `install.ps1 normalizes ignored build script bootstrap warnings before handing off to the shared installer`
5. Task bundle contains frozen spec, evidence, fresh verification, and task validate passes.
   - Proof: `spec.md`, `evidence.md`, `evidence.json`, `problems.md`, `raw/task-validate.txt`

## Residual Risk

- The shell-wrapper regression coverage for warning normalization is explicit on the PowerShell shim. The bash shim uses the same capture/classification strategy but is not covered by a warning-specific regression in this builder pass.
- The installer now validates the critical `tsx` + `esbuild` path only when pnpm actually reports ignored build scripts. If a future broken state arrives without that warning, it remains outside this task's scoped contract.
