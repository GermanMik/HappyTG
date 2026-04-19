# Evidence

## Scope

- Release: `0.3.16`
- Base version: `0.3.15`
- Canonical source task: `HTG-2026-04-19-installer-pairing-auto-handoff`
- Additional release-blocker fix included in this release prep:
  - `packages/bootstrap/src/install/index.ts`
  - `packages/bootstrap/src/install.runtime.test.ts`
  - `packages/bootstrap/src/install.test.ts`
  - `packages/bootstrap/src/install/tui.ts`
  - `apps/api/src/index.test.ts`

## Local Verification

- `pnpm release:check --version 0.3.16` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> pass
- `pnpm build` -> pass
- `pnpm --filter @happytg/bootstrap run test` -> pass
- `pnpm --filter @happytg/api run test` -> pass

## Notes

- GitHub Actions `Release` workflow `24625972276` completed successfully against `main` commit `745a6406a8d0ea68a1f7e0261a147ccacd5d2f0b`.
- GitHub published `HappyTG 0.3.16` at `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.16`.
