# Evidence

Status: passed for `pnpm happytg update`, docs, prompt, release metadata, and repo checks; `pnpm happytg verify` blocked by local environment prerequisites in the isolated worktree.

## Implementation Artifacts

- `.agent/prompts/local-update-uninstall-user-flow.md`
- `packages/bootstrap/src/cli.ts`
- `packages/bootstrap/src/cli.test.ts`
- `package.json`
- `packages/bootstrap/package.json`
- `README.md`
- `docs/quickstart.md`
- `docs/installation.md`
- `docs/bootstrap-doctor.md`
- `docs/troubleshooting.md`
- `docs/self-hosting.md`
- `docs/operations/runbook.md`
- `docs/release-process.md`
- `CHANGELOG.md`
- `docs/releases/0.4.9.md`
- workspace `package.json` files aligned to `0.4.9`

## Acceptance Evidence

1. `pnpm happytg update` exists and delegates to the existing installer engine with current-checkout, skipped background, skipped launch, and `doctor` plus `verify` defaults.
2. Reusable prompt artifact exists under `.agent/prompts/` and includes explicit task startup, scope, update/uninstall commands, docs scope, release handling, and completion rules.
3. The prompt covers one-line installer, existing local checkout, `current`/`update` repo modes, local `pnpm dev`, Docker isolated mode, Docker service reuse, self-hosted control plane, and execution-host cleanup.
4. The prompt includes 10 independent role reviews and converts their concerns into concrete requirements.
5. User-facing docs now share consistent guidance for `pnpm happytg update`, clean-checkout manual update, runtime restart, uninstall, Docker stop, and destructive volume/data deletion separation.
6. Release metadata is aligned at `0.4.9`; `pnpm release:check --version 0.4.9` passed.

## Raw Artifacts

- `raw/pnpm-install.txt`: passed.
- `raw/update-cli-test.txt`: passed.
- `raw/release-check.txt`: passed.
- `raw/lint.txt`: passed.
- `raw/typecheck.txt`: passed.
- `raw/test-unit.txt`: passed.
- `raw/test-integration.txt`: passed targeted bootstrap runtime coverage for Docker/reuse/repo update paths.
- `raw/build.txt`: passed.
- `raw/happytg-verify.txt`: command completed but HappyTG reported `[FAIL]` due missing `.env`, missing Telegram token, and local port conflicts in the isolated worktree.
- `raw/task-validate.txt`: passed.
- `raw/task-validate-final.txt`: passed after evidence/verdict update.

## Environment Blockers

- `.env` is absent in the isolated worktree by design; secrets were not copied into task evidence.
- `TELEGRAM_BOT_TOKEN` is not configured in that worktree.
- Local ports `3001`, `80`, `443`, and `3000` are occupied by other services on this machine.

## Scope Correction

APK creation is out of scope after the user's correction. This branch implements the prompt as a real local update/uninstall UX improvement through `pnpm happytg update`, prompt guidance, docs, and release metadata.
