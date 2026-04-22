# Evidence

## Release Metadata

- Workspace package versions are aligned to `0.4.1`.
- `CHANGELOG.md` contains `## v0.4.1`.
- `docs/releases/0.4.1.md` contains `# HappyTG 0.4.1` and the required `` `0.4.1` `` bullet.
- `pnpm release:check --version 0.4.1` passed in `raw/release-check.txt`.

## Included Repairs

- `HTG-2026-04-22-telegram-sendmessage-400-webapp-url` validates as complete/passed in `raw/task-validate-sendmessage.txt`.
- `HTG-2026-04-22-telegram-menu-button-caddy` validates as complete/passed in `raw/task-validate-menu-caddy.txt`.
- Merge with `origin/main` preserved the public `/telegram/webhook` Caddy contract, public Mini App auth/action endpoints, and explicit preflighted Telegram menu setup.

## Verification

- Bot unit tests passed: `raw/test-unit.txt`.
- Bootstrap/menu tests passed: `raw/test-integration.txt`.
- Bot typecheck/build/lint passed: `raw/typecheck-bot.txt`, `raw/build-bot.txt`, `raw/lint-bot.txt`.
- Repo typecheck/lint/test/build passed: `raw/typecheck.txt`, `raw/lint.txt`, `raw/test-repo.txt`, `raw/build.txt`.
- `pnpm happytg doctor` and `pnpm happytg verify` exited 0 with warning-level environment diagnostics already expected on this host: Codex websocket 403 fallback, local HTTP Mini App URL, and already-running services.
- Fresh verifier pass checked conflict markers, staged/unstaged whitespace, and release metadata: `raw/fresh-verifier.txt`.
- Release task validation passed: `raw/task-validate.txt`.
