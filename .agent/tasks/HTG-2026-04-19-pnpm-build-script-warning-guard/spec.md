# Task Spec

- Task ID: HTG-2026-04-19-pnpm-build-script-warning-guard
- Title: Guard installer against pnpm ignored build script warnings
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG has two distinct pnpm boundaries in the install path:

1. the bootstrap launcher in `scripts/install/install.ps1` and `scripts/install/install.sh` hands off with raw `pnpm dlx tsx packages/bootstrap/src/cli.ts install`;
2. the installer runtime in `packages/bootstrap/src/install/index.ts` resolves `pnpm` from PATH and treats `pnpm install` exit code `0` as unconditional success.

Repo-local investigation before build established the following:

- the repository pins `packageManager: "pnpm@10.0.0"` in the root `package.json`, but the launcher/runtime both execute `pnpm` from PATH instead of enforcing the pinned binary in-process;
- the current runtime `pnpm 10.0.0` does not support `pnpm approve-builds` in this environment;
- with a repro policy `only-built-dependencies=` the runtime `pnpm install` warning is real and reproducible for `tsx -> esbuild`, but under the current repo the resulting `tsx` and nested `esbuild` toolchain remain healthy;
- because `runPnpmInstall()` only checks exit code, the installer has no deterministic way to distinguish harmless policy noise from a post-install toolchain break and can therefore misclassify the final state if a future or environment-specific ignored-build-scripts warning actually leaves `tsx` unusable;
- any raw ignored-build-script warning that appears outside the TUI is a launcher boundary problem and must be normalized honestly rather than hidden cosmetically.

## Acceptance Criteria

1. Installer classifies ignored build script warnings deterministically instead of treating exit 0 as unconditional success.
2. Installer distinguishes warning-only healthy tsx/esbuild state from broken toolchain state with a repo-local post-install health check.
3. Installer guidance is based on the runtime pnpm capabilities used in the flow and never suggests unsupported commands.
4. Launcher/install flow no longer leaves raw ignored-build-script warning noise unsynchronized with installer UX when the warning is reproducible in the current code path.
5. Task bundle contains frozen spec, evidence, fresh verification, and task validate passes.

## Constraints

- Runtime: Codex CLI, repo-local bootstrap installer, no global pnpm policy mutation.
- Policy implications: do not auto-approve build scripts, do not weaken pnpm security posture, do not write to user home/global config as a workaround.
- Security boundaries: version-aware/actionable guidance is allowed; silently running blocked scripts or silently suppressing warning text is not allowed.
- Out of scope: broad package-manager upgrades, unrelated bootstrap UX refactors, changing dependency graph beyond what is required to classify/install-check this warning path.

## Verification Plan

- Unit:
  - extend `packages/bootstrap/src/install.runtime.test.ts` for:
    - ignored-build-scripts warning + healthy toolchain;
    - ignored-build-scripts warning + broken toolchain;
    - no-warning path unchanged;
    - version-aware guidance selection.
- Integration:
  - `pnpm --filter @happytg/bootstrap run test`
  - `pnpm --filter @happytg/bootstrap run typecheck`
  - `pnpm --filter @happytg/bootstrap run build`
  - targeted installer warning tests if split from the main bootstrap test run
  - if installer contract changes touch broader workspace behavior: `pnpm test` and `pnpm build`
- Manual:
  - capture repo-local repro commands for `pnpm install` with ignored build scripts under policy constraint;
  - capture runtime evidence for current `pnpm --version`, unsupported `approve-builds`, healthy `tsx`/nested `esbuild`, and launcher boundary behavior.
- Evidence files to produce:
  - `raw/build.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/typecheck.txt`
  - `raw/task-validate.txt`
  - additional repro artifacts for ignored-build-script classification and launcher/runtime pnpm capability checks
