# HTG-2026-06-10-desktop-projects-visible

## Scope

Make Codex Desktop projects visible from the Mini App Projects surface.

## Scope amendment

After the first fix was deployed locally, the live Mini App showed Desktop projects but Desktop task creation stayed disabled with:

```text
New Desktop Task disabled: Stable Codex Desktop New Task contract is unavailable.
```

The amended scope includes making the explicit stable app-server control mode (`HAPPYTG_CODEX_DESKTOP_CONTROL=app-server`) active in the default Codex Desktop adapter and verifying the public Mini App New Task page no longer renders the disabled contract message.

## Scope amendment 2

After the Desktop project/control repair, the Mini App still felt hung when opening Desktop New Task or Codex project/task views. Timing showed:

- `/new-task?source=codex-desktop` waited on full `/api/v1/codex-desktop/sessions` even though the form only needs projects and control availability.
- `/codex?source=codex-desktop` rendered hundreds of Desktop sessions, producing a very large HTML response.

The second amended scope includes removing the heavy Desktop sessions fetch from the New Task form and adding bounded Desktop session list projection for list screens.

## Scope amendment 3

After verification of the visible Desktop projects solution, the Projects page still lacked an explicit button for showing past/project tasks by project. The route already supports project-scoped Codex session filtering, so this scope adds clear project task/history actions to project cards without adding a new API or widening Desktop control.

## Scope amendment 4

After live Mini App Desktop New Task creation started working, newly-created Desktop tasks still did not reliably appear as Desktop sessions/details immediately after POST. The fourth amended scope includes projecting app-server `thread/list` sessions into the Codex Desktop session list, caching the `createTask` result as an immediate Desktop session projection, and returning a direct Desktop detail href from Mini App task creation.

## Scope amendment 5

After the Desktop session projection fix, opening a newly-created or existing Desktop task could still render:

```text
CODEX_DESKTOP_HISTORY_UNAVAILABLE
History недоступна
No Codex Desktop JSONL history file was found for this session.
```

The fifth amended scope includes reading bounded Desktop history from Codex app-server `thread/read` with `includeTurns: true`, rendering empty supported history as a neutral empty state, and opening newly-created Desktop task detail from the in-memory createTask history projection without waiting for slow app-server history reads.

## Acceptance criteria

- `/projects` fetches both HappyTG CLI workspaces and Codex Desktop projects.
- `/projects` renders a distinct Codex Desktop projects section when Desktop projects exist.
- Empty project messaging mentions both host daemon workspaces and Codex Desktop projects.
- Desktop project actions route to the existing Desktop-aware new task/Codex flow without creating a new unsafe control path.
- `HAPPYTG_CODEX_DESKTOP_CONTROL=app-server` enables the existing Codex app-server control contract in the default Desktop adapter.
- Public `/miniapp/new-task?source=codex-desktop` renders an enabled New Task form when the app-server contract is available.
- Desktop New Task GET uses a lightweight Codex Desktop control status instead of reading all Desktop sessions.
- Desktop sessions list API accepts a bounded `limit` for Mini App list screens.
- Desktop Codex/list screens request a bounded recent Desktop session list instead of rendering the entire Desktop history index.
- Projects UI has an explicit project-scoped task/history button for CLI and Desktop project cards.
- Desktop project cards in the Codex panel expose the same project-scoped task/history entrypoint.
- Desktop `createTask` results appear in `/api/v1/codex-desktop/sessions` without waiting for local JSONL/session-index writes.
- Mini App Desktop New Task POST returns `/codex/desktop-session?id=<threadId>`.
- Newly-created Desktop task detail opens locally and through the public `/miniapp` reverse proxy without the previous empty/404/hanging state.
- Desktop task detail for newly-created and existing app-server threads no longer shows `CODEX_DESKTOP_HISTORY_UNAVAILABLE` when app-server turn history is available.
- Newly-created Desktop task detail uses the createTask history projection immediately so the Mini App does not wait on `thread/read` before first render.
- Existing Codex Desktop source-aware session controls remain unchanged.
- Targeted and root validation pass or record non-blocking warnings.

## Out of scope

- Changing Codex Desktop app-server JSON-RPC semantics beyond wiring the existing explicit `app-server` mode into the default adapter.
- Changing Telegram bot menus.
- Importing Desktop sessions into HappyTG-owned session state.
- Exposing broad public `/api/v1/codex-desktop/*` routes.
