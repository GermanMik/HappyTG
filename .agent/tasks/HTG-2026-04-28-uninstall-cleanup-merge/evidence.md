# Evidence

Spec frozen before merge attempt.

## Branch Audit

- `gh pr list --state all --limit 100`: no open PRs; recent PRs `#37`-`#40` are merged.
- `git branch -r --no-merged origin/main`: remaining remote branches were audited.
- No merge needed:
  - `origin/codex/installer-docker-launch-mode`: patch-equivalent/already merged.
  - `origin/codex/installer-env-optional-values-followup`: patch-equivalent/already merged.
  - `codex/HTG-2026-04-23-enable-miniapp-launch-buttons`: patch-equivalent/already merged.
  - `origin/codex/release-0.3.10-warning-triage`: old proof-artifact/release triage branch.
  - `origin/codex/one-command-installer`: functionality already present on `main`.
  - `origin/codex/htg-2026-04-18-dev-port-conflict-triage`: functionality already present on `main`.
- Merge needed:
  - `codex/uninstall-multi-artifact-cleanup`: `main` lacked `packages/bootstrap/src/uninstall/index.ts` and `packages/bootstrap/src/uninstall.test.ts`.

## Merge Resolution

- Created `codex/uninstall-cleanup-merge-20260428`.
- Merged `codex/uninstall-multi-artifact-cleanup` with conflicts in:
  - `docs/troubleshooting.md`
  - `packages/bootstrap/src/cli.ts`
  - `packages/bootstrap/src/install/types.ts`
- Resolved conflicts by keeping current `main` installer launch/Docker behavior and adding uninstall support.
- Added the old branch's missing owned background artifact types back into `install/types.ts`.
- Updated test fixtures for the newer required `InstallResult.launch` field.

## Commands

- `pnpm --filter @happytg/bootstrap typecheck` -> pass. Raw: `raw/typecheck-bootstrap.txt`.
- `pnpm --filter @happytg/bootstrap test` -> pass, 132 tests. Raw: `raw/test-bootstrap.txt`.
- `pnpm lint` -> pass, 15/15 tasks. Raw: `raw/lint.txt`.
- `pnpm typecheck` -> pass, 15/15 tasks. Raw: `raw/typecheck.txt`.
- `pnpm test` -> pass, 15/15 tasks. Raw: `raw/test.txt`.
- `pnpm happytg verify` -> exit 0 with WARN status. Raw: `raw/verify.txt`.

## Verify Warnings

`pnpm happytg verify` reported environment warnings unrelated to this merge:

- Codex CLI websocket fallback warning.
- Public Caddy `/miniapp` route returned HTTP 200 without HappyTG Mini App identity.
- Host ports 80, 443, and 3000 are occupied by non-HappyTG listeners.
