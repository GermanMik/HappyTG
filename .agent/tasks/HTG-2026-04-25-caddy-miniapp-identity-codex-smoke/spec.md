# HTG-2026-04-25-caddy-miniapp-identity-codex-smoke

## Статус

Scope frozen: 2026-04-25.

## Контракт задачи

Исправить или правдиво классифицировать два readiness-блокера:

1. Public Caddy Mini App route `https://happytg.gerta.crazedns.ru/miniapp` возвращает HTTP 200, но не доказывает HappyTG Mini App identity.
2. Codex CLI smoke сообщает `Responses websocket` 403 Forbidden.

## Acceptance Criteria

- `/miniapp` на публичном HTTPS route возвращает HappyTG identity через `x-happytg-service: miniapp` или HTML/text с `<title>HappyTG Mini App</title>` и `happytg:miniapp:draft:v1`.
- Wrong-product HTML, generic root page, HealthOS или source HTML больше не считаются успешным Mini App route.
- Public API boundary остаётся узким: разрешены только Mini App API routes, generic `/api/*` заблокирован.
- `pnpm happytg telegram menu set --dry-run` проходит только после identity preflight.
- Codex websocket 403 либо исправлен, либо доказан как non-blocking warning только при наличии HTTP fallback и ожидаемого smoke stdout.
- `doctor --json` и `verify --json` остаются truthful: реальные route/Codex failures не скрываются.
- Fresh verifier pass проверяет evidence без production edits.

## Ограничения

- Не ослаблять проверку до "любой HTTP 200".
- Не публиковать generic `/api/*`.
- Не хардкодить единственный local-only upstream как универсальный production contract.
- Не записывать токены, cookies, credentials, Telegram user data или private session payloads.
- Если root cause вне репозитория, не имитировать repo-only code fix; записать operator config/commands и обновить docs/runbook только при необходимости.

## Branch / Worktree

Основной worktree `C:\Develop\Projects\HappyTG` был грязным на ветке `codex/installer-bottom-progress-substeps`. Чтобы не перезаписать чужие изменения, работа ведётся в отдельном clean worktree `C:\Develop\Projects\HappyTG-installer-docker-launch-mode` на ветке `codex/fix-caddy-miniapp-identity-codex-smoke`.

Dirty state исходного worktree записан в `raw/original-worktree-dirty-status.txt`.