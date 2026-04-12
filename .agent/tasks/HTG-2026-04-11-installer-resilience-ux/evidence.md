# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Runtime installer failures stay inside installer-native handling and never fall through to CLI usage. | packages/bootstrap/src/cli.ts; packages/bootstrap/src/install/index.ts; packages/bootstrap/src/cli.test.ts; packages/bootstrap/src/install.runtime.test.ts |
| Repo sync retries primary source exactly 5 times with visible progress, then automatically tries configured fallback source and reports source selection in summary/JSON. | packages/bootstrap/src/install/config.ts; packages/bootstrap/src/install/repo.ts; packages/bootstrap/manifests/installers/installers.yaml; packages/bootstrap/src/install.runtime.test.ts |
| Windows shim execution normalizes broken npm/pnpm-style wrappers and returns structured installer errors instead of ENOENT crashes. | packages/bootstrap/src/install/commands.ts; packages/bootstrap/src/install/errors.ts; packages/bootstrap/src/install.runtime.test.ts |
| Installer state persists user-provided values across reruns and resumes Telegram-first onboarding without re-entering saved data. | packages/bootstrap/src/install/state.ts; packages/bootstrap/src/install/index.ts; packages/bootstrap/src/install.runtime.test.ts |
| TUI paste works for Telegram fields without breaking raw-mode navigation/editing. | packages/bootstrap/src/install/tui.ts; packages/bootstrap/src/install.runtime.test.ts |
| Release metadata and proof bundle are updated for 0.3.1 with required repo verification. | CHANGELOG.md; docs/releases/0.3.1.md; README.md; package.json; apps/*/package.json; packages/*/package.json; .agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/release-check.txt |

Doctor/verify note: the raw doctor/verify logs are workspace-environment warnings caused by missing .env / TELEGRAM_BOT_TOKEN in this checkout, not by the installer changes.

## Artifacts

- packages/bootstrap/src/cli.ts
- packages/bootstrap/src/cli.test.ts
- packages/bootstrap/src/install/index.ts
- packages/bootstrap/src/install/types.ts
- packages/bootstrap/src/install/config.ts
- packages/bootstrap/src/install/errors.ts
- packages/bootstrap/src/install/state.ts
- packages/bootstrap/src/install/repo.ts
- packages/bootstrap/src/install/commands.ts
- packages/bootstrap/src/install/tui.ts
- packages/bootstrap/src/install/manifest.ts
- packages/bootstrap/src/install.runtime.test.ts
- packages/bootstrap/manifests/installers/installers.yaml
- CHANGELOG.md
- README.md
- docs/releases/0.3.1.md
- package.json
- apps/api/package.json
- apps/bot/package.json
- apps/host-daemon/package.json
- apps/miniapp/package.json
- apps/worker/package.json
- packages/approval-engine/package.json
- packages/bootstrap/package.json
- packages/hooks/package.json
- packages/policy-engine/package.json
- packages/protocol/package.json
- packages/repo-proof/package.json
- packages/runtime-adapters/package.json
- packages/shared/package.json
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/build.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/test-unit.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/lint.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/typecheck.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/test-integration.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/doctor.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/verify.txt
- /Users/mikhaylov-g/Documents/Develop/HappyTG/.agent/tasks/HTG-2026-04-11-installer-resilience-ux/raw/release-check.txt
