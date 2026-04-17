# Evidence Summary

## Status

- Phase: evidence
- Task ID: `HTG-2026-04-17-release-0311-publish`
- Coordinator: Codex main agent
- Verifier role: `task-verifier` (pending fresh pass)

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Workspace versions, changelog, and docs/releases/0.3.11.md are aligned at 0.3.11. | `package.json`, `apps/*/package.json`, `packages/*/package.json`, `CHANGELOG.md`, `docs/releases/0.3.11.md`, `raw/release-check.txt` |
| Release validation and repo checks pass for 0.3.11. | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test.txt`, `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/release-check.txt` |
| GitHub PR, merge, tag, and release for v0.3.11 are completed from the verified diff. | Pending publish after fresh verifier pass. |

## Release Scope

- This task publishes the already-verified product diff from `.agent/tasks/HTG-2026-04-17-release-0311-bootstrap-install-regressions/`.
- That source bundle already proves:
  - broken external `NODE_OPTIONS` preload paths were misdiagnosed as missing Node and are now classified truthfully;
  - `install.ps1` and `install.sh` now share the same bootstrap classification model;
  - the TUI running indicator regression is fixed with ASCII-safe glyphs;
  - legitimate environment warnings such as Codex websocket `403` and Mini App port `3001` remain visible instead of being hidden for a green result.

## Commands Run

- Release metadata validation:
  - `pnpm release:check --version 0.3.11`
- Release-branch verification:
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

## Key Results

- Workspace package versions now report `0.3.11` across all `14` checked manifests.
- `CHANGELOG.md` now contains a `## v0.3.11` section covering the bootstrap/preload fix, truthful warning handling, and TUI indicator restoration.
- `docs/releases/0.3.11.md` exists and describes the release scope, verification commands, and residual environment warnings honestly.
- `pnpm release:check --version 0.3.11` passed.
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed on the release branch.

## Residual Risk

- Publish artifacts are still pending at this stage: commit, push, PR, merge, tag, and GitHub Release will be recorded only after the fresh verifier pass.
- `pnpm lint` remains low-signal because several workspace lint scripts are still placeholder `echo "TODO: lint ..."` commands.
- The live Telegram timeout path was not re-reproduced during the release-publish pass; the release notes and evidence intentionally reference the completed bugfix bundle instead of overstating new machine-specific evidence.

## Fresh Verifier

- Independent verifier role: `task-verifier`
- Verifier agent: `019d9b64-db3c-7522-9d49-ceae3c036805` (`Carver`)
- Verifier verdict:
  - no blocking findings on release scope, versions, changelog, or release notes
  - source bundle linkage accepted
  - `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm release:check --version 0.3.11` accepted as sufficient pre-publish evidence
  - release `v0.3.11` was confirmed absent before publish
  - only remaining blocker was bundle state and missing `raw/task-validate.txt` before publish sync
