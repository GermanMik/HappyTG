# Evidence

## Diagnosis

- The previous `0.4.25` behavior intentionally included unscoped Codex Desktop sessions in project views and showed a notice.
- The current user requirement reverses that fallback: selected-project views should only show selected-project sessions and no more than `5`.

## Change

- `matchesCodexProject` now requires exact `repoName` or `projectPath` match when a project filter is active.
- Project-filtered results are capped with `cards.slice(0, 5)` after filtering and sorting.
- The unscoped Desktop-session notice was removed from the project-view path.
- The Desktop `limit=200` expansion action is disabled when a project filter is active.
- Regression coverage verifies:
  - matching project sessions render;
  - only `5` cards are visible;
  - the sixth matching session is hidden;
  - another project session is hidden;
  - unscoped Desktop session is hidden;
  - the old notice is absent;
  - the `Показать до 200 Desktop sessions` action is absent.

## Validation

- `pnpm --filter @happytg/miniapp test` passed.
- `pnpm --filter @happytg/miniapp typecheck` passed.
- `pnpm --filter @happytg/miniapp lint` passed.
- `pnpm --filter @happytg/miniapp build` passed.
- `pnpm release:check --version 0.4.27` passed.
- `git diff --check` passed.
- `pnpm happytg task validate --repo . --task HTG-2026-06-12-miniapp-project-session-cap` passed.
- Docker Mini App rebuild passed.
- Live Docker project-route smoke selected a project with `17` matching Desktop sessions and rendered `5 visible`, with no unscoped notice and no `Показать до 200 Desktop sessions`.
- Graphify query evidence recorded the Mini App source path.

Raw outputs are stored in `raw/`.
