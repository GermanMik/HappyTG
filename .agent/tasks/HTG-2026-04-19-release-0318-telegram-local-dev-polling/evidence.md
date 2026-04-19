# Evidence

## Scope

- Release: `0.3.18`
- Base version: `0.3.17`
- Canonical source task: `HTG-2026-04-19-telegram-local-dev-polling`

## Local Verification

- `pnpm release:check --version 0.3.18` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-telegram-local-dev-polling` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-release-0318-telegram-local-dev-polling` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> pass
- `pnpm build` -> pass

## Notes

- This release publishes the validated local Telegram polling fix for local-dev bot UX and includes a minimal `apps/api` startup handoff retry fix discovered by CI on the release branch before merge.
- PR `#21` merged the release branch into `main` at commit `2c3de440ace6de2fe7ca4536042f2b0ce499baad`.
- GitHub Actions `Release` workflow `24633114578` completed successfully against `main` commit `2c3de440ace6de2fe7ca4536042f2b0ce499baad`.
- GitHub published `HappyTG 0.3.18` at `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.18`.
