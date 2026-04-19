# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before metadata edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed via guarded GitHub `Release` workflow on latest `main`
- `complete`: completed

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

### Publish evidence

- `gh pr view 26 --json url,number,state,mergeCommit,headRefName,baseRefName,mergedAt` -> `raw/github-release-pr.json`
- `gh workflow run Release --ref main -f version=0.3.23 -f draft=false -f prerelease=false`
- `gh run view 24638178716 --json url,displayTitle,headBranch,headSha,status,conclusion,createdAt,updatedAt,jobs` -> `raw/github-release-run.json`
- `gh release view v0.3.23 --json url,tagName,name,isDraft,isPrerelease,publishedAt,targetCommitish` -> `raw/github-release.json`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-release-0323-startup-port-fix` -> `raw/task-validate.txt`

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

## Publish Outcome

- Release PR `#26` merged to `main`.
- Guarded GitHub Actions workflow `Release` completed successfully:
  - run: `24638178716`
  - head branch: `main`
  - head sha: `a70e2268c096dee8ddd0aae7c68449769f062ea6`
  - conclusion: `success`
- GitHub Release was created successfully:
  - tag: `v0.3.23`
  - name: `HappyTG 0.3.23`
  - published at: `2026-04-19T20:17:22Z`
  - url: `https://github.com/GermanMik/HappyTG/releases/tag/v0.3.23`
- Release proof bundle validation passed after publish finalization:
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

- `pnpm happytg verify` still reports the unrelated Codex transport warning on this machine; it is expected and not a release blocker for this version.
