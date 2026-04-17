# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Workspace package versions are aligned at `0.3.8`. | `package.json`, `apps/*/package.json`, `packages/*/package.json`, `raw/release-check.txt` |
| `CHANGELOG.md` and `docs/releases/0.3.8.md` accurately describe the installer diagnostics release and its user impact. | `CHANGELOG.md`, `docs/releases/0.3.8.md`, `.agent/tasks/HTG-2026-04-17-installer-diagnostics-proof-loop/evidence.md` |
| Release validation and repo checks pass before publish. | `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-unit.txt`, `raw/release-check.txt` |
| GitHub release/tag `v0.3.8` is created from the published `main` state using the checked-in release notes. | Pending publish after verifier pass. |

## Build Notes

- Commands executed:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm release:check --version 0.3.8`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-038-installer-diagnostics`
- Key outputs:
  - Workspace lint passed on the release branch; several package lint scripts remain placeholder `echo "TODO: lint ..."` commands and were left unchanged.
  - Workspace typecheck passed across all `13` packages.
  - Workspace tests passed across all `13` packages, including the already-merged installer diagnostics regressions.
  - Release validation passed for `0.3.8` across `14` package manifests, `CHANGELOG.md`, and `docs/releases/0.3.8.md`.
  - After proof-bundle sync, `task validate` reports `Phase: complete` and `Verification: passed`.

## Release Scope

- This task does not change production behavior; it ships the already-merged installer diagnostics follow-up from merge commit `6a1b39896a8590a2d0ae9524fcb09c97aeb87533` as release `0.3.8`.
- Source release content is summarized from `.agent/tasks/HTG-2026-04-17-installer-diagnostics-proof-loop/evidence.md`.

## Residual Risk

- Release notes summarize previously merged behavior rather than re-running the full machine-specific `setup` / `doctor` / `verify` reproduction on this metadata-only branch.
- Lint coverage remains only as strong as the repo's current scripts; several packages still use placeholder lint commands.

## Fresh Verifier

- Independent verifier role: `task-verifier`
- Verifier agent: `019d9a47-535c-7dd1-bdc7-5273c4e338e3` (`Huygens`)
- Verifier findings:
  - no production-code issues
  - release metadata is accurate
  - the only blocker was stale proof state and untracked release artifacts before staging
- Follow-up:
  - proof bundle synced to `complete/passed`
  - publish is expected to be clear after the final verifier confirmation
