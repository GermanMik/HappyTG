# HappyTG Mini App Rich UX

Wave 4 keeps the existing TypeScript `apps/miniapp` service and turns it into an action-first management surface. The backend remains source of truth; Telegram WebView state is local draft/context only.

## UX Principles

1. Instant clarity: Home shows active sessions, pending approvals, blocked sessions, and verify problems first.
2. Mobile-first: bottom navigation, compact cards, thumb-friendly actions, no dense admin tables.
3. Action-first: every screen exposes the next best action before raw details.
4. Progressive depth: summary first, then diff, verify details, artifacts, and timeline.
5. Continuity with bot: bot `web_app` links map to `screen=session|diff|verify|approvals` and ids.
6. Secure launch: `startapp` payload is not auth; backend validates Telegram `initData` and issues a short-lived app session.
7. Close/reopen resilience: safe drafts are stored locally with TTL and can be restored or cleared.
8. Trustworthy feedback: auth bootstrap, approval actions, and new-task submission must show in-flight, success, and failure states instead of failing silently.

## Information Architecture

- Home: dashboard and "Требует внимания".
- Sessions: operational session cards.
- Projects: рабочие каталоги и запуск новой Codex-сессии.
- Approvals: risk/action cards.
- Hosts: host health, repos, active sessions.
- Reports: proof-loop report cards.
- Details: Session, Approval, Host, Task/Bundle, Diff, Verify.

## Navigation Model

Bottom navigation contains Home, Sessions, Projects, Approvals, Hosts, Reports. Detail screens keep a compact title, primary action, and secondary actions as buttons. Bot deep links use query screens for continuity, while path routes remain stable for direct links. The active tab stays highlighted so the user always knows which operational area they are in.

## Screen Specs

- Dashboard: stats, attention list, recent sessions, recent reports, continue last session.
- Session list: title, repo, host, state, phase, verify state, next action.
- Session detail: header summary, actions, status grid, proof progress, timeline.
- Approvals: reason, risk, scope, expiry, linked session.
- Bundle/proof: grouped sections: Spec, Build, Evidence, Verify, Final.
- Diff: changed file count, high-risk files, file category filters, raw availability.
- Verify: PASS/FAIL/INCONCLUSIVE first, criteria counts, next best action.
- Hosts: status, last seen, repos, active sessions, last error.

## Component Map

- `renderPage`: shell, mobile CSS, bottom nav, auth bridge script, auth feedback state, draft recovery prompt.
- `renderDashboardView`: Home summary and attention.
- `renderSessionCards`, `renderApprovalCards`, `renderHostCards`, `renderReportCards`: list cards.
- `renderSessionDetail`: session cockpit.
- `renderDiffView`, `renderVerifyView`: decision-oriented deep views.
- API projections: `/api/v1/miniapp/dashboard`, `/sessions`, `/approvals`, `/hosts`, `/reports`, `/sessions/:id/diff`, `/sessions/:id/verify`, `/tasks/:id/bundle`.

## Launch And Auth Flow

1. Control plane creates a `MiniAppLaunchGrant` with kind, target, TTL, max uses, and signed short payload.
2. Telegram opens the shared Mini App URL with `startapp`.
3. Frontend reads Telegram WebApp `initData`.
4. Frontend posts `initData` and payload to `/api/v1/miniapp/auth/session`.
5. API validates Telegram hash, auth date, signed launch payload, expiry, revocation, use count, and user binding.
6. API issues a short-lived `MiniAppSession` token.
7. Frontend stores only this short-lived token and local drafts.

When the Mini App is served through a public HTTPS reverse proxy on `/miniapp`, browser-side API requests stay same-origin. The rendered page injects an empty browser API base so `fetch("/api/...")` resolves against the public Mini App origin instead of any local `localhost` API URL. Direct localhost development without reverse-proxy headers still falls back to the configured local API origin.

## Access Lifecycle

App sessions expire by `MINIAPP_SESSION_TTL_SECONDS`. Launch grants expire by `MINIAPP_LAUNCH_GRANT_TTL_SECONDS`, can be one-use or limited-use, and can be revoked. Dev-only query `userId` fallback remains available outside production for local SSR tests; production should use app-session tokens.

## Empty, Error, Recovery States

- No hosts: "Host еще не подключен", primary action pairing/help.
- No sessions: "Нет активных сессий", primary action hosts/new task.
- No approvals: "Нет pending approvals".
- Host disconnected: "Host offline", primary action check host.
- Session blocked: primary action open approval/session.
- Verify stale: primary action rerun verify.
- Launch expired: re-open from bot or request new link.
- Access denied: return to bot and re-open Mini App.
- Reconnect available: resume session.
- Draft found: continue or clear local draft.
- Auth pending: show Telegram/session/screen steps, retry action, and a clear explanation when the screen was opened outside Telegram.
- Approval/new task failure: keep the user on the same screen, show the backend error, and preserve available retry actions.

## Mobile Rules

- Keep card radius at 8px.
- Avoid raw logs on first view.
- Put primary actions in the first screen section.
- Keep lists scannable with status badges and one-line context.
- Use local storage only for safe draft text and current wizard context with TTL.
- Keep bottom navigation reachable by thumb inside Telegram WebView and make primary buttons large enough for one-handed use.

## Action Hierarchy

1. Risk/blocking actions: approval, resume, verify/fix.
2. Inspection actions: diff, evidence, proof timeline.
3. Secondary navigation: reports, hosts, raw artifacts.
4. Recovery actions: retry auth, reload screen, restore or clear draft.

## Microcopy Examples

1. `Сейчас ничего не требует внимания.`
2. `Нужно подтверждение.`
3. `Verify устарел после новых изменений.`
4. `Сессия остановилась и ждет действия.`
5. `Открыть approval.`
6. `Запустить fix.`
7. `Повторить verify.`
8. `Открыть evidence.`
9. `Diff пока недоступен.`
10. `Host еще не подключен.`
11. `Можно продолжить с места остановки.`
12. `Начать заново.`
13. `Proof-loop отчеты появятся после первой задачи.`
14. `Сначала summary, потом raw details.`
15. `Backend state не меняется.`
16. `Подключите host daemon через pairing.`
17. `Approve/deny без длинных логов в чате.`
18. `Decision-first summary.`
19. `Операционный список с next action.`
20. `Короткий статус, быстрые действия и переход к деталям.`

## Recovery Screen Examples

1. Draft found: continue or clear.
2. Launch grant expired: reopen from bot.
3. Launch grant revoked: request a new link.
4. Access denied: reauthenticate through Telegram.
5. No host paired: pair host.
6. Host offline: check host.
7. Session blocked: open approval.
8. Verify failed: run fix or inspect report.
9. Verify stale: rerun verify.
10. No reports: start a proof task.
11. Auth bootstrap failed: retry from the same screen or reopen from the bot.

## Compatibility Notes

The existing `/`, `/session/:id`, and `/task/:id` routes remain available. New query deep links from bot are additive. Store shape adds `miniAppLaunchGrants` and `miniAppSessions`; service code initializes these collections for older JSON stores.
