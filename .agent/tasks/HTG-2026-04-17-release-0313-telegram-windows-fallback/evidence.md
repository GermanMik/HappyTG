# Evidence Summary

## Status

- Phase: complete
- Task ID: `HTG-2026-04-17-release-0313-telegram-windows-fallback`
- Coordinator: Codex main agent
- Verifier role: fresh local verifier pass

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Workspace versions, `CHANGELOG.md`, and `docs/releases/0.3.13.md` are aligned at `0.3.13`. | `package.json`, `apps/*/package.json`, `packages/*/package.json`, `CHANGELOG.md`, `docs/releases/0.3.13.md`, `raw/release-check.txt` |
| Fresh release verification passes after the version bump. | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test.txt`, `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/release-check.txt`, `raw/source-task-validate.txt`, `raw/task-validate.txt` |
| Release notes truthfully describe the Windows Telegram transport fallback scope and reference the canonical fix bundle. | `docs/releases/0.3.13.md`, `.agent/tasks/HTG-2026-04-17-telegram-windows-transport-fallback/`, `raw/source-task-validate.txt` |

## Release Scope

- This task packages the already-verified product diff from `.agent/tasks/HTG-2026-04-17-telegram-windows-transport-fallback/`.
- That source bundle already proves:
  - bootstrap `getMe` now treats a validated Windows PowerShell probe as a real success after a Node HTTPS timeout;
  - bot `sendMessage` now retries through Windows PowerShell when the Node transport throws;
  - invalid-token and Telegram HTTP/API failures still stay truthful.

## Commands Run

- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm release:check --version 0.3.13`
- `pnpm --filter @happytg/bootstrap test && pnpm --filter @happytg/bot test`
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-telegram-windows-transport-fallback`
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0313-telegram-windows-fallback`

## Key Results

- All `14` checked workspace manifests now report version `0.3.13`.
- `CHANGELOG.md` contains `## v0.3.13` with the Windows Telegram transport fallback summary.
- `docs/releases/0.3.13.md` exists and links the release to the canonical fix bundle.
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @happytg/bootstrap test && pnpm --filter @happytg/bot test`, and `pnpm release:check --version 0.3.13` all passed after the version bump.

## Residual Risk

- `pnpm lint` remains low-signal because several workspace lint scripts are still placeholder `echo "TODO: lint ..."` commands.
- This task prepares and validates the `0.3.13` release content locally; GitHub tag/release workflow execution remains a separate operational step after merge to `main`.
