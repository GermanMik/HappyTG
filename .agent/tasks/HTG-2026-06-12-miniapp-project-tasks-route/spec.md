# HTG-2026-06-12-miniapp-project-tasks-route

## Scope

Update the Mini App project past-task navigation so clicking `Прошедшие задачи` from Projects stays in the Projects tab instead of activating Codex.

## Acceptance Criteria

- Project overview/detail `Прошедшие задачи` links point to `/projects/tasks` with the selected source and project.
- `/projects/tasks` renders the Codex history panel with bottom navigation `Проекты` active and `Codex` inactive.
- Search form submissions, source switches, and Desktop load-more links preserve the current route path.
- Direct `?userId=` navigation preserves session context across project past-task links and history-panel GET forms.
- Direct `/codex` history browsing keeps the existing Codex-tab behavior.
- Add regression coverage and run scoped Mini App validation.

## Non-goals

- No Codex Desktop mutation behavior changes.
- No auth, policy, approval, transport, or session-fetching behavior changes.
- No Desktop adapter storage rewrite.
