# Evidence

## Scope

- Release: `0.3.17`
- Base version: `0.3.16`
- Canonical source task: `HTG-2026-04-19-installer-final-summary-exit`

## Local Verification

- `pnpm release:check --version 0.3.17` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-installer-final-summary-exit` -> pass
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-release-0317-installer-final-summary-exit` -> pass
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> pass
- `pnpm build` -> pass

## Notes

- This release publishes the already-validated installer final-summary/exit follow-up plus explicit CLI-wrapper regression coverage.
- Publish artifacts will be added after push, merge, and guarded Release workflow completion.
