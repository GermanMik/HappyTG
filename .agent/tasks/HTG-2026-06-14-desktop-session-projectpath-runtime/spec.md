# HTG-2026-06-14-desktop-session-projectpath-runtime

## Scope

Repair the live Docker Mini App state where Codex Desktop projects were unavailable and the selected HappyTG project session queue rendered `0 visible`.

## Acceptance Criteria

- Docker API runs with the Codex Desktop read-only `/codex-home` mount.
- `/api/v1/codex-desktop/projects?userId=usr_1` returns local Desktop projects.
- Recent Desktop sessions include `projectPath` when the corresponding session JSONL contains `cwd`.
- `/projects/tasks?source=codex-desktop&project=<HappyTG>&userId=usr_1` renders selected-project sessions instead of `0 visible`.
- The selected-project cap remains `5 visible`.
- Add regression coverage for newest dated session JSONL discovery.
- Rebuild/restart the live Docker API/Mini App and verify local and public Mini App routes.

## Non-goals

- No change to Codex Desktop mutation/control support.
- No broad UI fallback that mixes unrelated or unscoped sessions into selected-project views.
- No changes to existing uncommitted Caddy/docs/infra edits.
