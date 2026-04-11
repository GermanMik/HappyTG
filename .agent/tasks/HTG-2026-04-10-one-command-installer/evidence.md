# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| `happytg install` is the primary interactive installer entrypoint and provides the required retro TUI screens for preflight, repo mode, Telegram setup, background run mode, progress, and final summary. | `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install/tui.ts`, `packages/bootstrap/src/cli.test.ts`, `packages/bootstrap/src/install.test.ts` |
| The shared bootstrap installer handles platform detection, repo sync decisions, safe dirty-worktree behavior, dependency installation, `.env` merge/backup behavior, Telegram-only onboarding, and Telegram bot token capture/verification while preserving Linux support. | `packages/bootstrap/src/install/platform.ts`, `packages/bootstrap/src/install/repo.ts`, `packages/bootstrap/src/install/env.ts`, `packages/bootstrap/src/install/telegram.ts`, `packages/bootstrap/src/install/background.ts`, `packages/bootstrap/manifests/installers/installers.yaml`, `.env.example` |
| Thin shell and PowerShell shims bootstrap a fresh machine and hand off to the shared repo/bootstrap installer implementation without creating a parallel installer. | `scripts/install/install.sh`, `scripts/install/install.ps1` |
| Installer reruns are idempotent and safe, machine-readable paths exist where appropriate, existing bootstrap commands remain compatible, and required docs/manifests/tests are updated. | `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/install.test.ts`, `README.md`, `docs/installation.md`, `docs/quickstart.md`, `docs/bootstrap-doctor.md`, `docs/configuration.md` |
| The installer eliminates the recurring missing-token setup error by collecting `TELEGRAM_BOT_TOKEN`, persisting it safely, and surfacing the configured bot identity for later `/pair <CODE>` authorization messaging. | `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/install/tui.ts`, `packages/bootstrap/src/index.ts`, `apps/host-daemon/src/index.ts`, `apps/host-daemon/src/index.test.ts` |
| Release metadata is updated for the installer launch: workspace package versions are bumped consistently, changelog/release notes are added, and the repo-level release validation passes for the selected version. | `package.json`, `apps/*/package.json`, `packages/*/package.json`, `CHANGELOG.md`, `docs/releases/0.3.0.md`, `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/release-check.txt` |

## Key Outcomes

- Added `happytg install` to the existing bootstrap CLI instead of introducing a parallel installer.
- Implemented a retro Telegram-first TUI with explicit keyboard hints, active cursor, status blocks, and progress/final-summary screens.
- Added safe repo sync decisions for `clone`, `update`, and `current` modes, including dirty-worktree strategies.
- Added platform shims for macOS/Linux and Windows that clone or update the repo and invoke the shared TypeScript installer via `pnpm dlx tsx`, avoiding a broken dependency on untracked `dist` artifacts.
- Made Telegram bot token collection part of install and required it for non-interactive mode, then persisted bot identity for later `/pair <CODE>` instructions.
- Bumped the workspace to release version `0.3.0` and added matching changelog/release notes.

## Verification

- `pnpm --filter @happytg/bootstrap test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm release:check --version 0.3.0`
- `TELEGRAM_BOT_TOKEN=... TELEGRAM_BOT_USERNAME=happytg_bot pnpm happytg doctor`
- `TELEGRAM_BOT_TOKEN=... TELEGRAM_BOT_USERNAME=happytg_bot pnpm happytg verify`
- `pnpm build`
- `pnpm happytg --help`

## Verification Outcomes

- `pnpm --filter @happytg/bootstrap test`: passed, including installer-specific coverage for platform detection, repo mode decisions, dirty worktree defaults, `.env` merge idempotency, and retro renderer hints.
- `pnpm lint`: passed. The repo still uses placeholder lint scripts in multiple packages; this is pre-existing and unchanged by this task.
- `pnpm typecheck`: passed.
- `pnpm test`: passed across the workspace.
- `pnpm release:check --version 0.3.0`: passed.
- `pnpm happytg doctor`: completed with warnings because the local repo root still has no committed `.env` and no Redis on `localhost:6379`.
- `pnpm happytg verify`: completed with the same environment warnings as `doctor`; no installer-specific regressions were reported.
- `pnpm build`: passed.
- `pnpm happytg --help`: confirmed the new `happytg install` surface appears in CLI usage.

## Residual Notes

- `doctor` / `verify` remain `WARN` in this workspace until a real `.env` is created and Redis is running locally. That is expected local-state behavior and not a blocker for the installer/release scope.
