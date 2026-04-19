# Evidence

## Scope

- Release: `0.3.19`
- Base version: `0.3.18`
- Canonical source task: `HTG-2026-04-19-telegram-start-still-silent`

## Local Verification

- `pnpm --filter @happytg/bot run test` -> pass
- `pnpm --filter @happytg/bot run typecheck` -> pass
- `pnpm --filter @happytg/bot run build` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-telegram-start-still-silent` -> pass
- `pnpm release:check --version 0.3.19` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> pass
- `pnpm build` -> pass
- `pnpm happytg doctor` -> expected env fail in clean release worktree (`.env` and `TELEGRAM_BOT_TOKEN` absent)
- `pnpm happytg verify` -> expected env fail in clean release worktree (`.env` and `TELEGRAM_BOT_TOKEN` absent)

## Notes

- This release publishes the validated Windows-only Telegram transport fallback for hosts where `0.3.18` already selected polling correctly but Node/undici still could not reach Telegram Bot API.
- `doctor` and `verify` were rerun intentionally in the sterile release worktree. They reported only environment prerequisites missing in that worktree, not a code regression in the release candidate.
- PR `#22` merged the release branch into `main` at commit `4e28c1e28cffd129ec41d3397497976943ac086b`.
- GitHub Actions `Release` workflow `24634374778` completed successfully against `main` commit `4e28c1e28cffd129ec41d3397497976943ac086b`.
- GitHub published `HappyTG 0.3.19` at `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.19`.
