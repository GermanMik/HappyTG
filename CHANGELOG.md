# Changelog

## Unreleased

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
