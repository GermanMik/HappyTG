# Evidence Summary

## Scope Delivered

Release `0.3.12` replaces the install-finalization string list with a shared structured automation model and threads that model through bootstrap onboarding, install completion, plain-text CLI rendering, TUI rendering, and JSON output.

The implementation stays scoped to install finalization, onboarding/output consistency, regression coverage, and release metadata. It does not simulate user Telegram actions and does not hide real machine-specific warnings.

## Baseline

### Old root cause

`raw/setup-json-before.txt` captures the old `reportJson.onboarding.planPreview` shape. It is a flat string list that mixes:

- reuse guidance:
  - `Redis, PostgreSQL, and S3-compatible storage already look reachable locally. Reuse them and skip Docker shared infra entirely.`
  - `Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy.`
- manual actions:
  - `Request a pairing code on the execution host: pnpm daemon:pair.`
  - `Send /pair <CODE> to Telegram, then start the daemon with pnpm dev:daemon.`
- extra overlap:
  - `Redis is already running. Use it and skip compose redis unless you deliberately remap the host port.`

That baseline proves the original defect: one flat list carried reuse, manual work, and anti-footgun advice without type information or dedupe.

### Baseline install limitation

`raw/install-json-before.txt` and `raw/install-final-summary-before.txt` record an honest environment limitation while reproducing old install behavior from a detached `HEAD` worktree: the old installer fails repo-sync with `fatal: 'main' is already used by worktree at 'C:/Develop/Projects/HappyTG'`.

This limitation is preserved in the proof bundle instead of being hidden. The old flat next-step model is therefore evidenced primarily through `setup`/`doctor` onboarding output and source diff, while install-specific before/after is evidenced from the current branch after the fix.

## Implementation

### Structured model

- `packages/bootstrap/src/finalization.ts`
  - introduces the shared automation item model:
    - `auto`
    - `manual`
    - `warning`
    - `reuse`
    - `conflict`
    - `blocked`
  - provides grouping, dedupe helpers, and legacy compatibility builders
- `packages/bootstrap/src/index.ts`
  - replaces ad-hoc onboarding string construction with typed onboarding items
- `packages/bootstrap/src/install/index.ts`
  - derives final install automation items from post-check onboarding plus live installer state
  - auto-runs safe local pair-code acquisition when prerequisites are satisfied
  - reclassifies background launcher outcomes based on what actually happened
  - suppresses already-applied steps from pending `nextSteps`
  - dedupes warnings against structured finalization items

### Surface consistency

- `packages/bootstrap/src/cli.ts`
  - renders grouped Auto-run / Requires user / Blocked / Reuse / Conflicts sections
- `packages/bootstrap/src/install/tui.ts`
  - renders the same grouped sections in the TUI final screen
- `packages/bootstrap/src/install/types.ts`
  - exposes `finalization.items` in the install result JSON

### Regression coverage

- `packages/bootstrap/src/install.runtime.test.ts`
  - auto-requested pair code becomes an `auto` step with concrete `/pair CODE`
  - background requested-vs-actual mismatch stays a warning
  - duplicate warning text is suppressed when the same message is already a structured conflict
- `packages/bootstrap/src/install.test.ts`
  - TUI final screen groups structured items and dedupes warnings
- `packages/bootstrap/src/cli.test.ts`
  - plain-text output renders grouped sections instead of a noisy `Next steps` block
- `packages/bootstrap/src/index.test.ts`
  - invalid Telegram configuration blocks pairing instead of suggesting `pnpm daemon:pair`

## Acceptance Criteria Mapping

1. Structured install finalization distinguishes auto/manual/warning/reuse/conflict/blocked guidance.
   - Evidence:
     - `packages/bootstrap/src/finalization.ts`
     - `packages/bootstrap/src/index.ts`
     - `packages/bootstrap/src/install/types.ts`
     - `raw/setup-json-after.txt`
     - `raw/install-json-after.txt`
2. Safe local steps are auto-run, already-executed steps are suppressed from pending next steps, and manual Telegram handoff remains explicit.
   - Evidence:
     - `packages/bootstrap/src/install/index.ts`
     - `packages/bootstrap/src/install.runtime.test.ts`
     - `raw/install-json-after.txt`
3. TUI, plain text, and JSON surfaces stay consistent without duplicate or contradictory advice.
   - Evidence:
     - `packages/bootstrap/src/cli.ts`
     - `packages/bootstrap/src/install/tui.ts`
     - `packages/bootstrap/src/cli.test.ts`
     - `packages/bootstrap/src/install.test.ts`
     - `raw/install-final-summary.txt`
     - `raw/install-json-after.txt`
4. Regression coverage exists for dedupe, pair flow, infra reuse/conflict, and background launcher classification.
   - Evidence:
     - `packages/bootstrap/src/install.runtime.test.ts`
     - `packages/bootstrap/src/install.test.ts`
     - `packages/bootstrap/src/cli.test.ts`
     - `packages/bootstrap/src/index.test.ts`
     - `raw/test-unit.txt`
     - `raw/test-integration.txt`
5. Proof bundle is complete and a fresh verifier pass succeeds before publish.
   - Evidence:
     - `raw/lint.txt`
     - `raw/typecheck.txt`
     - `raw/build.txt`
     - `raw/test-unit.txt`
     - `raw/test-integration.txt`
     - `raw/release-check.txt`
     - `raw/task-validate.txt`
     - `verdict.json`
     - `problems.md`

## Current After-State

### Install finalization after the fix

`raw/install-json-after.txt` records the current machine's truthful classified result:

- `reuse`
  - shared infra is already reachable
  - some HappyTG services are already running
- `conflict`
  - Mini App port `3001` is occupied by `contacts-frontend`
- `blocked`
  - Telegram pairing is blocked because the configured bot token currently fails `getMe` with `401`

`raw/install-final-summary.txt` shows the same state in plain text, grouped by severity/type. The duplicate mini-app message is no longer repeated under both conflicts and warnings.

### Setup/doctor/verify after the fix

`raw/setup-json-after.txt`, `raw/doctor-json-after.txt`, and `raw/verify-json-after.txt` all keep the same real environment facts visible while exposing the onboarding/finalization model in a typed way.

## Verification

Recorded command outputs:

- `raw/release-check.txt`
  - `pnpm release:check --version 0.3.12`
- `raw/build.txt`
  - `pnpm build`
- `raw/lint.txt`
  - `pnpm lint`
- `raw/typecheck.txt`
  - `pnpm typecheck`
- `raw/test-unit.txt`
  - `pnpm --filter @happytg/bootstrap typecheck`
  - `pnpm --filter @happytg/bootstrap test`
- `raw/test-integration.txt`
  - `pnpm test`
- `raw/install-json-after.txt`
  - `pnpm happytg install --json --non-interactive --repo-mode current --repo-dir . --background skip --post-check setup`
- `raw/setup-json-after.txt`
  - `pnpm happytg setup --json`
- `raw/doctor-json-after.txt`
  - `pnpm happytg doctor --json`
- `raw/verify-json-after.txt`
  - `pnpm happytg verify --json`
- `raw/task-validate.txt`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0312-install-finalization-automation`

### Release-tail CI fix

The first release workflow attempts on GitHub Actions exposed two Linux-only bootstrap test assumptions after merge:

- `packages/bootstrap/src/index.test.ts`
  - the `setup treats compatible Redis, PostgreSQL, and MinIO listeners as supported reuse while flagging unrelated conflicts` test incorrectly assumed the MinIO API suggested port must be greater than the MinIO console port
  - the same test also hard-coded a Windows-style quoted shell example for MinIO port overrides, while Linux renders the same assignment without quotes
  - on Linux, ephemeral port allocation and shell formatting made those assumptions false even though the production logic remained correct

The scoped fix changes the assertions to:

- require the suggested MinIO API port to be greater than its own occupied port and still distinct from the other reserved ports
- accept both quoted and unquoted shell env assignment formats for MinIO override examples

`raw/test-unit.txt` and `raw/test-integration.txt` were refreshed after those fixes.

## Environment Truths Preserved

The release does not hide real external constraints on the maintainer machine:

- Telegram bot validation currently fails with `401 Unauthorized`, so pairing stays blocked in the real install capture.
- Codex still reports a websocket `403 Forbidden` fallback warning before switching to HTTP.
- Mini App port `3001` is still occupied by Docker container `contacts-frontend`.
- Shared infra and some HappyTG services are already reachable/running and are classified as `reuse`, not as steps to start again.
