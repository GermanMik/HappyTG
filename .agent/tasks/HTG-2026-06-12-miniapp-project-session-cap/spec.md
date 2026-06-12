# HTG-2026-06-12-miniapp-project-session-cap

## Scope

Update the Mini App Codex project view so it does not show broad/unscoped Desktop history when a project is selected.

## Acceptance Criteria

- Project-filtered Codex Desktop results include only sessions that match the selected project by `projectPath` or `repoName`.
- Desktop sessions without project identity are not shown in selected-project views.
- The project view renders at most `5` session cards.
- The project view does not show the `Codex Desktop did not attach a project path...` notice.
- The project view does not offer the `Показать до 200 Desktop sessions` expansion action.
- Add regression coverage and run scoped Mini App validation.

## Non-goals

- No Codex Desktop mutation behavior changes.
- No auth, policy, approval, or transport behavior changes.
- No Desktop adapter storage rewrite.
