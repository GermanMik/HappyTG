# HTG-2026-06-14-miniapp-empty-sessions-repair

## Scope

Repair the Mini App Codex Desktop project/session view when a selected project shows `0 visible` and the empty state `Нет активных сессий`, even though the shell status reports available Codex Desktop projects and sessions.

## Repair Prompt

Investigate the Mini App route that renders `Codex / Сессии` and the API/adapter projection that feeds it. Preserve the existing `0.4.27` behavior: selected-project views must remain strict, show only sessions for the selected project, and render at most five cards. Fix only the mismatch that makes valid selected-project Codex Desktop sessions disappear. Add regression coverage for the reported empty-state scenario, then run the smallest relevant validation so dependency and type failures are caught.

## Acceptance Criteria

- A selected Codex Desktop project with matching Desktop session history renders matching session cards instead of `0 visible`.
- Matching tolerates equivalent Windows path spellings where safe, including slash direction and case differences.
- Selected-project views still exclude unrelated or unscoped Desktop sessions.
- Selected-project views still render at most `5` session cards.
- The empty state remains available when there are truly no matching sessions.
- Regression tests cover the path normalization mismatch and the strict unrelated-session exclusion.
- Raw validation output is saved under `raw/`.

## Non-goals

- No change to Codex Desktop mutation, approval, or policy behavior.
- No change to Telegram as an approval/render surface.
- No broad adapter rewrite or runtime storage migration.
- No dependency upgrades unless a validation failure proves they are required.
