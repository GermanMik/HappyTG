# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before metadata edits
- `build`: completed
- `evidence`: completed for local release gate
- `fresh verify`: pending publish and release workflow evidence
- `complete`: pending GitHub release publication

## Commands Run

### Release metadata preparation

- bumped all workspace package versions from `0.3.22` to `0.3.23`
- updated `CHANGELOG.md`
- added `docs/releases/0.3.23.md`

### Local release validation

- `pnpm release:check --version 0.3.23` -> `raw/release-check.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-unit.txt`
- `pnpm build` -> `raw/build.txt`
- `pnpm happytg verify` -> `raw/verify.txt`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-startup-port-proof-loop` -> `raw/source-task-validate.txt`
- `raw/test-integration.txt` records that this release metadata layer does not add a separate integration-only command beyond repo-wide `pnpm test`

## Scope Decision

- This release is publish-only metadata on top of already-landed product code.
- Canonical product evidence remains the source proof bundle:
  - `.agent/tasks/HTG-2026-04-19-startup-port-proof-loop/`
- The release task does not add new startup logic, startup tests, or runtime behavior beyond versioning/docs/release publication.

## Builder Outcome

- `pnpm release:check --version 0.3.23` passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all passed on the release branch.
- `pnpm happytg verify` remained green-with-existing-machine-warning:
  - Codex websocket `403 Forbidden` fallback to HTTP
  - running-stack reuse on ports `3007`, `4000`, `4100`, and `4200`
- Source task validation stayed green:
  - `HTG-2026-04-19-startup-port-proof-loop`
  - `Validation: ok`
  - `Phase: complete`
  - `Verification: passed`

## Files Changed

- `package.json`
- `apps/api/package.json`
- `apps/bot/package.json`
- `apps/host-daemon/package.json`
- `apps/miniapp/package.json`
- `apps/worker/package.json`
- `packages/approval-engine/package.json`
- `packages/bootstrap/package.json`
- `packages/hooks/package.json`
- `packages/policy-engine/package.json`
- `packages/protocol/package.json`
- `packages/repo-proof/package.json`
- `packages/runtime-adapters/package.json`
- `packages/shared/package.json`
- `CHANGELOG.md`
- `docs/releases/0.3.23.md`

## Residual Risk

- Publish evidence is not complete until the release PR is merged to `main` and the guarded GitHub `Release` workflow completes successfully from the latest default-branch HEAD.
- `pnpm happytg verify` still reports the unrelated Codex transport warning on this machine; it is expected and not a release blocker for this version.
