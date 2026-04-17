# HTG-2026-04-17-installer-warning-repair

## Baseline

Fresh baseline commands were captured before any code edits:

- `pnpm happytg setup --json` -> `warn`
- `pnpm happytg doctor --json` -> `warn`
- `pnpm happytg verify --json` -> `warn`
- `pnpm happytg repair --json` -> `warn`
- `pnpm happytg install --json --non-interactive --repo-mode current --repo-dir . --background skip --post-check setup` -> `fail` / `recoverable-failure`
- `pnpm lint` -> pass
- `pnpm typecheck` -> pass
- `pnpm test` -> fail

Raw artifacts:

- `raw/setup-json.txt`
- `raw/doctor-json.txt`
- `raw/verify-json.txt`
- `raw/repair-json.txt`
- `raw/install-json.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-integration-baseline.txt`

## Signal Classification

### setup / doctor / verify / repair

- `CODEX_SMOKE_WARNINGS`: truthful environment warning.
  - All four commands reproduced the same wording: Codex Responses websocket returned `403 Forbidden`, then the CLI fell back to HTTP.
- `SERVICES_ALREADY_RUNNING`: truthful environment warning.
  - The API listener on `4000` is real and reuse guidance is consistent.
- `MINIAPP_PORT_BUSY`: truthful environment warning.
  - The listener attribution to Docker container `contacts-frontend` on `3001` is specific and actionable.
- Shared Redis/Postgres/MinIO reuse guidance: truthful environment signal.
  - These are classified as reuse rather than conflict.
- Pairing steps (`pnpm daemon:pair`, `/pair <CODE>`, `pnpm dev:daemon`): expected manual handoff.

### install

- Telegram `getMe` `failureKind: invalid_token`: truthful environment warning.
  - The fallback transport reached Telegram and got `401 Unauthorized`, while Node HTTPS separately timed out earlier.
  - That combination makes the current decisive classification `invalid_token`, not generic transport failure.
- `installer_partial_failure` / pairing blocked: expected manual handoff.
  - Pairing is correctly blocked until the operator fixes the bot token.
- Codex `403` warning in `postChecks`: truthful environment warning.
- Running-stack reuse and Mini App `3001` conflict in finalization: truthful environment warnings.

### Historical log artifact

- Pairing code `FSEQ58` from the supplied log: stale artifact.
  - It expired at `2026-04-17T14:22:20.331Z` and does not appear in the fresh local runs.

## Reproduced Scoped Issue

- The only fresh red after the baseline was `pnpm test`.
- Failure scope:
  - `packages/bootstrap/src/install.runtime.test.ts`
  - `runHappyTGInstall semantically dedupes repeated setup next steps and compresses repeated post-check warning sets`
  - `runHappyTGInstall removes contradictory start commands when setup already says to reuse the running stack`
- Root cause:
  - Those tests implicitly read the maintainer machine's real `~/.happytg/daemon-state.json`, which currently contains a persisted `hostId`.
  - That made `runHappyTGInstall` legitimately replace manual pairing-code guidance with reuse guidance, so the assertions were no longer hermetic.
- Classification:
  - false positive / misclassification in regression tests, not a reproduced runtime product bug.

## Fix

- Minimal change in `packages/bootstrap/src/install.runtime.test.ts`.
- Added repo-local `.env` content with `HAPPYTG_STATE_DIR=<temp test dir>` in the two failing tests so they do not read the real home-directory daemon state.
- No production code changed.

## Post-Fix Verification

- `pnpm --filter @happytg/bootstrap typecheck` -> pass (`raw/build.txt`)
- `pnpm --filter @happytg/bootstrap test` -> pass (`raw/test-unit.txt`)
- `pnpm lint` -> pass (`raw/lint-after.txt`)
- `pnpm typecheck` -> pass (`raw/typecheck-after.txt`)
- `pnpm test` -> pass (`raw/test-integration.txt`)
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-installer-warning-repair` -> `Validation: ok`, `Phase: complete`, `Verification: passed` (`raw/task-validate.txt`)

## Fresh Verifier Pass

- Verifier role: `task-verifier`
- Agent id: `019d9bdb-808d-7b62-9fad-7c69611c5d4b`
- Outcome: code/runtime verification passed; proof bundle initially failed only because metadata was not finalized.
- After synchronizing `task.json`, `spec.md`, and `verdict.json`, the repo-native `task validate` command also passed.

## Docs Check

Reviewed without changes:

- `docs/bootstrap-doctor.md`
- `docs/proof-loop.md`
- `docs/releases/0.3.12.md`

These docs already match the reproduced current behavior: structured finalization, explicit blocked pairing on Telegram failure, reuse guidance, and truthful Codex `403` fallback warning handling.
