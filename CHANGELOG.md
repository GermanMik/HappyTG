# Changelog

## Unreleased

## v0.3.9

### Fixed

- Telegram installer `getMe` diagnostics now run a safe Windows PowerShell follow-up probe after Node HTTPS transport failures so HappyTG can distinguish Node/curl-specific Bot API timeouts from invalid tokens and from broader Bot API reachability issues.
- Telegram warning text now explains why Telegram Desktop working on the same host does not automatically clear Bot API HTTPS failures, and invalid-token follow-up probes now stay classified as invalid token instead of degrading into a vague API warning.
- Codex smoke warnings now say when the Responses websocket returned `403 Forbidden` but the CLI successfully fell back to HTTP, keeping the warning truthful while making its non-blocking nature explicit.
- Installer post-check output now compresses repeated `setup`/`doctor`/`verify` warning sets and semantically deduplicates overlapping `pnpm dev`, pairing, and daemon-start next steps in the final summary.

### Changed

- Release metadata is aligned at `0.3.9` across the workspace for the installer publish-flow follow-up release.

## v0.3.8

### Fixed

- Telegram `getMe` diagnostics now distinguish DNS, timeout, TLS, proxy, HTTP, and non-JSON failures instead of collapsing them into a generic `fetch failed` warning.
- Windows Codex wrapper detection and smoke checks no longer produce contradictory repeated PATH and smoke-failure warnings when the npm-installed `codex.cmd` wrapper is runnable.
- Planned-port diagnostics now attribute listeners, distinguish supported reuse of local Redis/Postgres/MinIO services from real conflicts, and suggest non-colliding alternative ports for actual conflicts such as Mini App port `3001`.

### Changed

- Final installer/setup/doctor/verify summaries are now deduplicated against the full planned-port set and keep only truthful environment warnings after the diagnostics fixes land.
- Release metadata is aligned at `0.3.8` across the workspace for the installer diagnostics follow-up release.

## v0.3.7

### Fixed

- Interactive installer Telegram token entry now starts blank instead of reusing persisted token values from `.env` or saved draft state.
- The Telegram token reducer keeps supporting clear-then-paste replacement, so replacing a token after deleting the existing draft remains stable in the interactive flow.
- Interactive installer coverage now asserts that pre-existing token state does not leak back into the initial Telegram screen while freshly pasted tokens still save normally.

### Changed

- Release metadata is aligned at `0.3.7` across the workspace for the Telegram token field follow-up release.

## v0.3.6

### Fixed

- Windows installer Telegram input now commits pasted terminal chunks that already include trailing newline or CRLF, so bot tokens and allowed user IDs survive real interactive paste flows.
- Telegram allowed user ID normalization now accepts comma- or newline-separated pasted values without regressing typed editing, masking, or token validation.
- Bootstrap Redis guidance now names supported non-Docker alternatives such as existing `REDIS_URL` / shared-service endpoints instead of implying Docker Compose is the only viable path.

### Changed

- Release metadata is aligned at `0.3.6` across the workspace for the Windows installer paste and dockerless-guidance follow-up release.

## v0.3.5

### Fixed

- Installer final summaries now aggregate warning-level follow-up from `setup`, `doctor`, and `verify` post-checks instead of dropping those findings after step-local rendering.
- Repeated Windows `CODEX_PATH_PENDING` follow-up from the three post-checks is now deduplicated into one final warning and one actionable PATH next step.
- Warning-only Windows install runs now keep both Telegram lookup warnings and Codex PATH follow-up visible in the final installer summary without regressing back to a recoverable failure state.

### Changed

- Release metadata is aligned at `0.3.5` across the workspace for the Windows installer post-check summary follow-up release.

## v0.3.4

### Fixed

- Windows bootstrap now detects runnable Codex wrappers in standard user npm bin directories such as `%APPDATA%\\npm` even when `npm prefix -g` probing is unavailable in the current shell.
- Installer post-checks no longer escalate that Windows APPDATA wrapper case into a false missing-Codex recoverable failure; the outcome now stays at warning level with explicit PATH follow-up guidance.
- `CODEX_PATH_PENDING` diagnostics now include the recovered wrapper directory in both findings and next-step text, making the fix actionable instead of generic.

### Changed

- Release metadata is aligned at `0.3.4` across the workspace for the Windows APPDATA Codex wrapper follow-up release.

## v0.3.3

### Fixed

- Installer Telegram diagnostics now distinguish invalid token/config problems from recoverable `getMe` lookup failures such as fetch/network errors.
- Installer now preserves an already-known `TELEGRAM_BOT_USERNAME` for pair guidance when live Telegram identity lookup is the only failing layer, so configured bots no longer look fully unconfigured after a secondary lookup warning.
- Windows installer/bootstrap follow-up checks now recover through runnable npm-installed Codex wrappers and downgrade that state to a PATH follow-up warning instead of cascading into a false missing-Codex failure.
- Windows npm global bin injection inside the installer now uses normalized PATH handling, avoiding mixed-case `Path` / `PATH` loss that could make post-check execution more brittle.
- Plain-text installer summaries now show Telegram as configured with an identity-lookup warning/failure when appropriate, reducing contradictory user-facing output.

### Changed

- Release metadata is aligned at `0.3.3` across the workspace for the Windows installer/runtime diagnostics follow-up release.

## v0.3.2

### Fixed

- Installer TUI now renders Telegram bot token input as a masked preview that preserves the first 4 and last 4 characters, keeps the raw secret in persisted state only, and degrades safely for short values.
- Telegram setup validation now blocks incomplete values such as missing BotFather tokens or `@botname` usernames before runtime execution, keeping interactive and non-interactive installer failures installer-native.
- Installer completion now normalizes outcomes across success, warning-only success, recoverable failure, and fatal failure so warning-only Telegram lookup issues no longer appear as contradictory `[FAIL]` summaries.
- Final installer screens now close cleanly from `ENTER close`, and interactive installs no longer fall through to an extra plain-text summary after the TUI screen has already resolved.
- Structured install results now distinguish warning-only outcomes from recoverable partial failures, including completed runs where follow-up steps such as post-checks still need attention.

### Changed

- Release metadata is aligned at `0.3.2` across the workspace for the installer UX/runtime follow-up release.

## v0.3.1

### Fixed

- Installer runtime failures now stay inside installer-native handling instead of falling through to the top-level CLI usage banner.
- Repo sync now retries transient remote failures 5 times, surfaces attempt progress, and automatically switches to the configured fallback source before returning a structured failure.
- Windows command execution now normalizes generic npm-style shims such as `pnpm.cmd`, recovers from broken shim launches where safe, and reports actionable structured failures when spawn still fails.
- Installer reruns now resume from persisted onboarding state so Telegram bot token, allowed user IDs, home channel, background mode, repo location, repo source, and post-check choices do not need to be re-entered after a failed run.
- Telegram setup input now handles pasted multi-character chunks without breaking raw-mode editing, cursor flow, or retro TUI navigation.

### Changed

- Release metadata is aligned at `0.3.1` across the workspace for the installer resilience update.

## v0.3.0

### Added

- Introduced `happytg install` as the unified one-command installer inside the existing bootstrap CLI.
- Added retro TUI onboarding screens for preflight, repo mode selection, Telegram setup, background run mode, progress, and final summary.
- Added cross-platform installer shims at `scripts/install/install.sh` and `scripts/install/install.ps1` that bootstrap the repo and hand off to the shared TypeScript installer flow.

### Changed

- Installer onboarding is now Telegram-first only and collects `TELEGRAM_BOT_TOKEN`, allowed user IDs, and home channel during installation.
- Repository onboarding now supports clone, update, and current-directory modes with safe dirty-worktree handling and idempotent `.env` merge behavior.
- Pairing/setup guidance now reuses the configured Telegram bot identity so `/pair <CODE>` instructions point to the correct bot automatically.
- Release metadata is aligned at `0.3.0` across the workspace for the installer launch.

### Docs

- Rewrote first-run instructions in [README](./README.md), [Installation](./docs/installation.md), [Quickstart](./docs/quickstart.md), [Bootstrap Doctor](./docs/bootstrap-doctor.md), and [Configuration](./docs/configuration.md) around the new one-command installer.

## v0.2.0

### Fixed

- Hardened Windows home resolution so `~` and `~/...` respect env-driven home overrides consistently, including Windows-style env-key casing.
- Hardened Codex detection for Windows PATH shim scenarios such as `codex.cmd`, mixed `Path` / `PATH`, and mixed `PATHEXT` casing.
- Clarified bootstrap diagnostics so "Codex CLI not found" is reserved for true missing-binary cases instead of broken-but-present installs.

### Docs

- Refined GitHub-facing onboarding in [README](./README.md), [Quickstart](./docs/quickstart.md), [Installation](./docs/installation.md), [Bootstrap Doctor](./docs/bootstrap-doctor.md), and [Troubleshooting](./docs/troubleshooting.md).
- Replaced path-like navigation labels with document-title links where that improved first-run readability.

## v0.1.0

Первый зафиксированный релиз HappyTG.

### Что вошло

- кроссплатформенный first-run path для Windows/macOS/Linux
- более понятный onboarding и диагностика для Codex CLI, pairing и miniapp
- обработка конфликтов порта miniapp без unhandled stack trace
- снижение шума в `host-daemon` при ожидаемых first-run состояниях
- структурированный plain-text вывод для `happytg doctor` / `verify`
- progress indicator по proof loop в Mini App
- `happytg doctor` остаётся зелёным при известных benign warning'ах Codex CLI, при этом подробная диагностика сохраняется в `--json`
- обновлённые инструкции первого старта и запуска

### Проверки

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm lint`

### Тег релиза

- `v0.1.0`
