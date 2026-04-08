# Changelog

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
