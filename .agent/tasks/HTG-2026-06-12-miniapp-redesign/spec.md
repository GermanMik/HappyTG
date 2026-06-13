# HTG-2026-06-12-miniapp-redesign

## Frozen scope

Переработать текущий server-rendered Telegram Mini App дизайн в `apps/miniapp/src/index.ts` по prompt и mockup, не создавая новый frontend-проект и не меняя runtime/control-plane contracts.

## In scope

- Обновить visual system, AppShell, Telegram theme variables, mobile-first card/list/button styles.
- Сократить bottom navigation до основных mobile tabs.
- Унифицировать helpers для `StatusChip`, карточек, collapsible sections, empty/error/loading states.
- Переработать основные Mini App screens:
  - `/`
  - `/codex`
  - `/sessions`
  - `/projects`
  - `/project/:id`
  - `/new-task`
  - `/approvals`
  - `/approval/:id`
  - `/codex/desktop-session`
  - `/diff/:sessionId`
  - `/verify/:sessionId`
  - `/hosts`
  - `/host/:id`
  - `/reports`
  - `/task/:id`
- Скрыть technical/raw details за `details/summary`.
- Сохранить existing auth flow and draft recovery.
- Обновить focused Mini App tests только там, где текст/markup ожидания меняются из-за нового дизайна.

## Out of scope

- React/Next/Vite migration.
- Backend API redesign.
- Changes to `packages/policy-engine`, `packages/approval-engine`, worker, daemon or mutating authorization flow.
- Release/version bump or git commit.
- Storing secrets, tokens, raw env values, private endpoints in UI or memory.

## Acceptance criteria

- `pnpm --filter @happytg/miniapp run typecheck` passes.
- `pnpm --filter @happytg/miniapp run test` passes.
- `pnpm lint` passes, or any failure is recorded with exact reason.
- Listed Mini App routes still render in focused smoke/tests.
- Destructive actions remain visually separated and are not made unguarded.
- Proof artifacts are updated under this directory.
