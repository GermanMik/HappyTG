# HTG-2026-04-23-miniapp-dead-buttons-ux-redesign

## Frozen Scope

Диагностировать и исправить текущую поломку Telegram Mini App, где Mini App открывается из Telegram, но user-facing actions не работают, а затем выполнить ограниченный mobile-first UX redesign без изменения базовой HappyTG архитектуры.

Задача обязана:

- доказать точный root cause dead-button симптома на публичном HTTPS `/miniapp`, а не принять гипотезу за факт;
- восстановить рабочий auth bootstrap и primary interactions для Telegram-launched Mini App на публичном HTTPS маршруте;
- сохранить строгий публичный контракт Caddy: публичны только `/miniapp`, `/api/v1/miniapp/auth/session`, `/api/v1/miniapp/approvals/{id}/resolve`, `/telegram/webhook`, `/health`, `/static/*`;
- оставить localhost direct Mini App development рабочим и явно задокументированным;
- сделать request-aware browser API base derivation для Mini App без раскрытия generic `/api/*`;
- убрать silent failure у auth bootstrap и primary actions, добавив видимые loading/error/success states;
- улучшить мобильный UX/CJM через action-first shell, hierarchy, CTA placement, recovery states и feedback, не меняя frontend framework.

## Explicit Questions To Answer

1. Какие именно элементы реально ломаются в проблемном публичном сценарии:
   только JS actions, только approval actions, только auth-gated screens или весь UI?
2. Какой именно browser-side request или console error воспроизводится в failing flow?
3. Какое точное значение внедряется в `window.HAPPYTgApiBase` при открытии Mini App через `https://happytg.gerta.crazedns.ru/miniapp`, и почему?
4. Причина user-visible failure: mixed-content blocking, недостижимый `localhost` из Telegram WebView, неверная public/private origin derivation, auth bootstrap failure, silent catch path или их комбинация?
5. Какой минимальный исправляющий change сохраняет:
   local direct dev на `localhost`,
   public HTTPS Mini App доступ через Caddy,
   строгие публичные API boundary?
6. Какие UX изменения реально сокращают time-to-action и улучшают CJM, а не только визуально перекрашивают экран?

## Acceptance Criteria

1. Доказан точный root cause dead-button симптома на публичном HTTPS `/miniapp`.
2. Telegram-launched Mini App восстанавливает рабочий auth bootstrap и primary interactions без раскрытия generic `/api/*`.
3. Local direct Mini App development на `localhost` остается рабочим и задокументированным.
4. Mini App browser API derivation становится request-aware и покрыта регрессиями.
5. Primary actions получают явные loading/error/success feedback вместо silent failure.
6. Mobile-first UX/CJM улучшены без смены framework и без нарушения архитектурных инвариантов.
7. Свежий verifier pass, `pnpm happytg task validate --repo . --task HTG-2026-04-23-miniapp-dead-buttons-ux-redesign` и релиз `0.4.4` завершены с commit/push/merge.

## Constraints

- Preserve architecture invariants from `AGENTS.md` and repo docs.
- Не мигрировать Mini App на новый frontend framework.
- Не ослаблять Mini App auth, approval или route-level exposure rules.
- Не раскрывать публично generic `/api/*` ради того, чтобы frontend заработал.
- Backend остается source of truth; browser state может быть только локальным helper state.
- Предпочесть ограниченные правки в `apps/miniapp`, связанных тестах, `apps/api`, Caddy/docs только при необходимости, и release metadata.
- Не записывать в артефакты секреты, токены, Telegram `initData`, cookies или private user data.

## Verification Plan

- Freeze/spec:
  - сформировать proof bundle и зафиксировать scope до production edits;
  - снять sanitized env summary, current code-path analysis и public-route contract notes.
- Reproduction/evidence:
  - получить page source/public-route injection до фикса;
  - зафиксировать browser-equivalent console/network evidence для failing auth bootstrap;
  - провести 10-lens UX audit и CJM review текущего Mini App.
- Targeted verification:
  - `pnpm --filter @happytg/miniapp test`
  - `pnpm --filter @happytg/miniapp typecheck`
  - `pnpm --filter @happytg/miniapp build`
  - `pnpm --filter @happytg/miniapp lint`
  - `pnpm --filter @happytg/api test`
- Expanded verification if routing/auth/docs/release metadata change:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm happytg doctor`
  - `pnpm happytg verify`
  - `pnpm release:check --version 0.4.4`
- Bundle/verifier:
  - `pnpm happytg task validate --repo . --task HTG-2026-04-23-miniapp-dead-buttons-ux-redesign`
  - отдельный fresh verifier pass без production edits.

## Required Evidence Files

- `raw/init-analysis.txt`
- `raw/log-snippet.txt`
- `raw/env-summary-sanitized.txt`
- `raw/browser-api-base-before.txt`
- `raw/browser-api-base-after.txt`
- `raw/network-before.txt`
- `raw/network-after.txt`
- `raw/console-before.txt`
- `raw/console-after.txt`
- `raw/ux-audit-notes.txt`
- `raw/cjm-review.txt`
- `raw/before-screenshots.txt`
- `raw/after-screenshots.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/typecheck.txt`
- `raw/build.txt`
- `raw/lint.txt`
- `raw/task-validate.txt`
- `raw/fresh-verifier.txt`

## Out Of Scope

- New transport architecture.
- Generic public API expansion beyond the documented Mini App contract.
- Any policy weakening between global/deployment/workspace/project/session/command layers.
- Frontend framework rewrite.
- Unrelated installer/bootstrap work already present in other branches or worktrees.
