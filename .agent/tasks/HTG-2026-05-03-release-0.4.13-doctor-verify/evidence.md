# Evidence

## Release Basis

- `gh release view v0.4.12` confirmed `v0.4.12` is published and not draft/prerelease.
- Current repo version before release prep was `0.4.12`.
- Target release is patch `0.4.13` for the already-merged PR #54 doctor/verify warning cleanup plus one release-blocker follow-up for the same Codex smoke classifier family.

## Metadata Changes

- Updated all 16 workspace `package.json` files to `0.4.13`.
- Added `CHANGELOG.md` section `v0.4.13`.
- Added `docs/releases/0.4.13.md`.

## Release-Blocker Fix During Prep

- Initial `pnpm happytg doctor` on the release branch showed a new successful-smoke warning variant: `codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit`.
- Added the matching benign pattern next to the existing `codex_core::models_manager::manager` pattern and covered it in `packages/runtime-adapters/src/index.test.ts`.
- Final `pnpm happytg doctor` and `pnpm happytg verify` both pass.

## Command Evidence

| Command | Result | Raw output |
| --- | --- | --- |
| `pnpm --filter @happytg/runtime-adapters test` | PASS | `raw/test-runtime-adapters.txt` |
| `pnpm --filter @happytg/bootstrap test` | PASS | `raw/test-bootstrap.txt` |
| `pnpm build` | PASS | `raw/build-final.txt` |
| `pnpm lint` | PASS | `raw/lint-final.txt` |
| `pnpm typecheck` | PASS | `raw/typecheck-final.txt` |
| `pnpm test` | PASS | `raw/test-final.txt` |
| `pnpm happytg doctor` | PASS | `raw/doctor-final.txt` |
| `pnpm happytg verify` | PASS | `raw/verify-final.txt` |
| `pnpm release:check --version 0.4.13` | PASS | `raw/release-check-final.txt` |
| `pnpm happytg task validate --repo . --task HTG-2026-05-03-release-0.4.13-doctor-verify` | PASS | `raw/task-validate.txt` |
| `git diff --check` | PASS | `raw/diff-check.txt` |

## Fresh Verifier

Fresh verifier pass reviewed the frozen spec, release metadata diff, classifier follow-up diff, tests, raw command outputs, release notes, CHANGELOG, package versions, and proof files. Verdict: PASS, no blocking findings.
