# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Repeated installs with different background modes keep enough ownership metadata for truthful uninstall cleanup. | `packages/bootstrap/src/install/types.ts`, `packages/bootstrap/src/install/background.ts`, and `packages/bootstrap/src/install/state.ts` now persist normalized `ownedArtifacts` for background automation and merge them across repeated writes to `state/install-last.json`. Regression `packages/bootstrap/src/install.state.test.ts` proves that a scheduled-task install followed by a startup install preserves both recorded artifacts instead of overwriting the earlier ownership metadata. |
| Uninstall removes all recorded launcher artifacts for the current local state scope without deleting unowned global launchers. | `packages/bootstrap/src/uninstall/index.ts` removes all recorded launcher artifacts for the current state scope, always cleans the local launcher path, and only falls back to default global launchers from the default state scope. `packages/bootstrap/src/uninstall.test.ts` covers Linux cleanup, repeated Windows scheduled-task plus startup cleanup in a custom state scope, and the safe custom-state case where unowned default launchers are preserved. `raw/uninstall.txt` records an isolated CLI proof run removing a recorded startup shortcut and launcher from a temp `HAPPYTG_STATE_DIR`. |
| Windows regressions cover scheduled-task plus startup leftovers across repeated installs and docs stay truthful. | Windows repeated-install cleanup is covered in `packages/bootstrap/src/uninstall.test.ts` and `packages/bootstrap/src/install.state.test.ts`; CLI command exposure is covered in `packages/bootstrap/src/cli.ts`, `packages/bootstrap/src/cli.test.ts`, `package.json`, and `packages/bootstrap/package.json`; operator docs were updated in `docs/installation.md`, `docs/quickstart.md`, `docs/self-hosting.md`, `docs/troubleshooting.md`, and `docs/engineering-blueprint.md`. |

Build/verification notes:
- `pnpm --filter @happytg/bootstrap build` passed.
- `pnpm --filter @happytg/bootstrap test` passed with new uninstall and install-state regressions.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed.
- `pnpm happytg doctor` and `pnpm happytg verify` exited `0` with warning-level environment findings only: Codex websocket `403 Forbidden` fallback to HTTP and already-running HappyTG services on ports `3007/4000/4100/4200`.
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-uninstall-multi-artifact-cleanup` confirms the finalized bundle metadata.

## Artifacts

- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\spec.md
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\build.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\test-unit.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\uninstall.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\lint.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\typecheck.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\test-integration.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\doctor.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\verify.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-04-19-uninstall-multi-artifact-cleanup\raw\task-validate.txt
