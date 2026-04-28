# HappyTG Bot-First UX

Wave 2 turns the Telegram bot into a concise control surface. The bot remains a renderer/controller over the control-plane API; it is not the source of truth for sessions, approvals, hosts, or tasks.

## Principles

- Commands are entry points; buttons are the main interaction.
- `/start` and `/menu` show the same compact dashboard.
- The task flow is wizard-first: host, repo, mode, instruction, confirmation.
- Smart defaults skip host/repo choices when there is only one option.
- Chat stays quiet: one session card per session, separate messages only for approvals, errors, completion, and explicit user requests.
- Large diff, verify details, raw logs, and artifacts are routed to the Mini App.
- Approval prompts show what, why, risk, scope, and expiry.

## Conversation Map

1. `/start` or `/menu` renders the main menu with active session, approval, attention, and proof-task counts.
2. `Новая задача` starts the wizard.
3. Wizard selects host and workspace, or skips either step when a single safe default exists.
4. User selects quick or proof-loop mode.
5. User sends one instruction message.
6. Bot renders a confirmation card.
7. On `Запустить`, API creates the session and returns either a session card or an approval dialog.
8. Session cards expose `Кратко`, `Resume`, `Diff`, `Verify`, `Mini App`, and `Остановить` for non-terminal sessions.
9. Approval dialogs expose one-time, phase, session, deny, and details actions.

## Main Menu

Buttons:

- `Новая задача` -> `m:t`
- `Активные сессии` -> `m:s`
- `Подтверждения` -> `m:a`
- `Хосты` -> `m:h`
- `Последние отчеты` -> `m:r`
- `Открыть Mini App` -> Telegram `web_app` URL

The text shows active sessions, pending approvals, sessions requiring attention, unfinished proof tasks, and the last host/repo.

## Callback Contracts

- Menu: `m:t`, `m:s`, `m:a`, `m:h`, `m:r`
- Wizard: `w:h:<hostId>`, `w:w:<workspaceId>`, `w:m:q`, `w:m:p`, `w:c`, `w:b`, `w:x`
- Session: `s:u:<sessionId>`, `s:r:<sessionId>`, `s:d:<sessionId>`, `s:v:<sessionId>`, `s:c:<sessionId>`
- Approval: `a:o:<approvalId>:<nonce>`, `a:p:<approvalId>:<nonce>`, `a:s:<approvalId>:<nonce>`, `a:d:<approvalId>:<nonce>`, `a:x:<approvalId>`
- Legacy approval callbacks `approval:approve:<approvalId>` and `approval:reject:<approvalId>` remain accepted for compatibility.

Approval callback payloads stay below Telegram callback limits by using short prefixes. API resolution remains idempotency-aware through approval state and nonce checks.

## Message Copy Guidelines

- Use short action-first text.
- Name user concepts: host, repo, session, task, approval, report.
- Do not paste raw logs into chat.
- Prefer "what changed / what needs attention / next action" over system internals.
- Use Mini App links for deep inspection.

## Anti-Noise Policy

1. `/menu` and callbacks render concise cards.
2. Long-running session updates should edit the session card when the runtime supplies edit capability; otherwise they should send only important state changes.
3. Approvals are allowed as separate messages because they require action.
4. Diff, verify details, artifacts, and logs stay in the Mini App or repo proof bundle.
5. Recovery messages explain the next action in one step.

## User-Friendly Bot Messages

1. `HappyTG. Что делаем дальше?`
2. `Сначала подключите host, на котором лежит repo.`
3. `Host подключен: devbox. Теперь можно запускать задачи.`
4. `Выберите host для новой задачи.`
5. `Host: devbox. Теперь выберите repo.`
6. `Repo: api. Выберите режим.`
7. `Напишите быстрый вопрос или короткую задачу одним сообщением.`
8. `Опишите задачу одним сообщением. Я запущу proof-loop.`
9. `Проверим перед запуском.`
10. `Сессия создана. Для продолжения нужно подтверждение.`
11. `Активных сессий нет. Можно начать новую задачу.`
12. `Подтверждений сейчас нет.`
13. `Большой diff удобнее смотреть в Mini App.`
14. `Verify details удобнее смотреть в Mini App.`
15. `Ок, задачу не запускаю.`
16. `Черновик задачи устарел. Начните заново через /task.`
17. `Сессия ожидает reconnect host.`
18. `Fresh verify прошел. Полный отчет открыт в Mini App.`
19. `Proof task требует внимания: verify stale.`
20. `Я не знаю такую команду. Откройте меню и выберите действие кнопкой.`

## Approval Dialog Examples

1. `Что: изменить файлы в repo. Зачем: выполнить proof task. Риск: высокий.`
2. `Что: запустить verify. Зачем: проверить acceptance criteria. Риск: средний.`
3. `Что: изменить конфигурацию. Зачем: применить setup fix. Риск: высокий.`
4. `Что: выполнить bootstrap install. Зачем: подготовить runtime. Риск: высокий.`
5. `Что: затронуть путь вне repo. Зачем: записать artifact. Риск: критический.`
6. `Что: отправить изменения наружу. Зачем: publish branch. Риск: критический.`
7. `Что: изменить файлы в repo. Scope сейчас: once.`
8. `Что: изменить файлы в repo. Scope сейчас: phase.`
9. `Что: изменить файлы в repo. Scope сейчас: session.`
10. `Что: запустить verify. Истекает: 10 минут.`

## Recovery Messages

1. `Не нашел такой pairing code. Запросите новый через pnpm daemon:pair.`
2. `Pairing code истек. Запросите свежий через pnpm daemon:pair.`
3. `Это подтверждение устарело. Откройте актуальный список approvals.`
4. `Это подтверждение уже обработано. Откройте approvals, если нужно проверить состояние.`
5. `Host больше недоступен. Откройте список hosts и выберите заново.`
6. `Repo больше недоступен. Выберите repo заново.`
7. `На этом host пока нет доступных repos. Запустите daemon.`
8. `Telegram не передал данные пользователя. Повторите действие из личного чата.`
9. `Не получилось выполнить действие: <reason>.`
10. `Сначала подключите host через pnpm daemon:pair и /pair CODE.`

## API Dependencies

Wave 2 bot UX uses existing control-plane service plus these projection routes:

- `GET /api/v1/hosts?userId=...`
- `GET /api/v1/hosts/:id/workspaces?userId=...`
- `GET /api/v1/sessions?userId=...`
- `POST /api/v1/sessions/:id/cancel`
- `GET /api/v1/approvals?userId=...&state=waiting_human,pending`
- `GET /api/v1/miniapp/bootstrap?userId=...`
- `POST /api/v1/approvals/:id/resolve` with optional `scope` and `nonce`
