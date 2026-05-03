# HTG-2026-05-03 UX 10-Role Prompt Evidence

## Init

- EchoVault project context was retrieved.
- EchoVault search was run for `HappyTG design miniapp bot usability prompt roles`.
- Details were fetched for relevant prompt/design/release memories where available.
- Work started from clean `main`.
- Branch `codex/happytg-ux-10-role-prompt-release` was created.
- `spec.md` was frozen before adding prompt/release artifacts.

## Code Map

- `docs/prompts/happytg-ux-10-role-optimization.md`
  - New reusable execution prompt for a future comprehensive Mini App and Bot UX/design pass.
  - Requires 10 independent role assessments before implementation decisions.
  - Separates Mini App deep-inspection UX from Bot concise-control UX.
  - Encodes HappyTG invariants for source/runtime discrimination, unsupported action honesty, serialized mutations, policy-before-approval, lazy heavy runtime initialization, proof evidence, memory, branch/PR, and release.
- `package.json`, `apps/*/package.json`, `packages/*/package.json`
  - Version bumped from `0.4.10` to `0.4.11` because `0.4.10` is already published.
- `CHANGELOG.md`
  - Added `v0.4.11` entry.
- `docs/releases/0.4.11.md`
  - Added release notes for the prompt artifact.
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/`
  - Proof bundle for this prompt/release task.

## Verification Evidence

- `raw/build.txt`: `pnpm build` passed.
- `raw/lint.txt`: `pnpm lint` passed.
- `raw/typecheck.txt`: `pnpm typecheck` passed.
- `raw/test-unit.txt`: `pnpm test` passed.
- `raw/test-integration.txt`: `pnpm --filter @happytg/api test` passed.
- `raw/doctor.txt`: `pnpm happytg doctor` exited 0 with existing environment warning.
- `raw/verify.txt`: `pnpm happytg verify` exited 0 with same existing environment warning.
- `raw/release-check.txt`: `pnpm release:check --version 0.4.11` passed.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-05-03-ux-10-role-prompt` passed.
- `raw/fresh-verifier.txt`: fresh read-only verifier pass returned PASS with no blocking findings.

## Warnings / Residuals

- `doctor` and `verify` warn that Codex Responses websocket returned `403 Forbidden`, then the CLI fell back to HTTP.
- `doctor` and `verify` report existing HappyTG services already running on ports 3007, 4000, and 4100.
- This release creates the execution prompt; it does not implement the future UX redesign itself.
