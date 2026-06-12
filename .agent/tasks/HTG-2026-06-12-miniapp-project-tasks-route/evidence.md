# Evidence

## Diagnosis

- Project cards and project detail pages sent `Прошедшие задачи` to `/codex?...`.
- The Mini App bottom nav uses the current route/nav key, so opening those links from Projects activated `Codex`.
- Live direct `?userId=` smoke also showed that the generated `/projects/tasks` href must preserve `userId`; otherwise the next SSR request renders the auth shell instead of the history panel.
- The correct user-facing behavior is to browse selected project history without leaving the Projects navigation context.

## Change

- Added `/projects/tasks` as a project-nav route that renders the existing Codex history panel.
- Made Codex history links route-aware through `codexPanelHref`, `projectTasksHref`, and `renderSourceSwitcher`.
- The project-scoped route sets `routePath: "/projects/tasks"` and `resetHref: "/projects"`.
- Project past-task links and the history-panel GET form preserve `userId` when the current request uses direct `?userId=` session context.
- The normal `/codex` route keeps the default `routePath: "/codex"`.
- Regression coverage verifies:
  - project pages link `Прошедшие задачи` to `/projects/tasks`;
  - `/projects/tasks` renders the selected past task;
  - `Проекты` is active and `Codex` is not active;
  - the search form posts back to `/projects/tasks`;
  - hidden `userId` is preserved;
  - reset returns to `/projects?userId=...` when direct `userId` context is present.

## Validation

- `pnpm --filter @happytg/miniapp test` passed.
- `pnpm --filter @happytg/miniapp typecheck` passed.
- `pnpm --filter @happytg/miniapp lint` passed.
- `pnpm --filter @happytg/miniapp build` passed.
- `pnpm release:check --version 0.4.28` passed.
- `git diff --check` passed.
- `pnpm happytg task validate --repo . --task HTG-2026-06-12-miniapp-project-tasks-route` passed.
- Docker Mini App rebuild passed.
- Live Docker Projects-route smoke passed.
- Graphify query evidence recorded the Mini App routing path.

Raw outputs are stored in `raw/`.
