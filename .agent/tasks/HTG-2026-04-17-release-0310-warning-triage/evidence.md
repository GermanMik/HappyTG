# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed
- `minimal fix`: completed
- `complete`: pending
- `finish/publish`: in progress

## Commands Run

### Baseline reproduction

- `pnpm happytg setup --json` -> `raw/setup-json.txt`
- `pnpm happytg doctor --json` -> `raw/doctor-json.txt`
- `pnpm happytg verify --json` -> `raw/verify-json.txt`
- `pnpm happytg install --json` -> `raw/install-json.txt`
- `pnpm lint` -> `raw/lint.txt` (baseline pre-fix pass)
- `pnpm typecheck` -> `raw/typecheck.txt` (baseline pre-fix pass)
- `pnpm test` -> `raw/test-unit.txt` (baseline pre-fix pass)

### Targeted probes

- Telegram transport split probe with redaction -> `raw/telegram-probe.txt`
- Direct Codex smoke run -> `raw/codex-smoke.txt`
- Scoped bootstrap regressions -> `raw/test-bootstrap.txt`

### Verification

- `pnpm build` -> `raw/build.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-unit.txt`
- `pnpm release:check --version 0.3.10` -> `raw/release-check.txt`
- Post-fix `pnpm happytg setup --json` -> `raw/setup-json-final.txt`
- Post-fix `pnpm happytg doctor --json` -> `raw/doctor-json-final.txt`
- Post-fix `pnpm happytg verify --json` -> `raw/verify-json-final.txt`
- Post-fix `pnpm happytg install --json --repo-mode current --dirty-worktree keep` -> `raw/install-json-keep-final.txt`
- Post-fix exact `pnpm happytg install --json` on the dirty working tree -> `raw/install-json-final.txt` (expected dirty-checkout guard, not a diagnostics regression)
- `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0310-warning-triage` -> `raw/task-validate.txt`

### Independent verifier pass

- `task-verifier` run `verifier-2026-04-17T12:59:59.4864354+03:00` passed with no findings.
- Fresh verifier reruns are captured in `raw/setup-json-verifier.txt`, `raw/doctor-json-verifier.txt`, and `raw/verify-json-verifier.txt`.
- `verdict.json` and `problems.md` were updated by the independent verifier after the shared onboarding contradiction fix.

## Findings

- Baseline `install --json` still surfaced legitimate Telegram/Codex/Mini App warnings, but its final `nextSteps` contradicted themselves by keeping `pnpm dev` alongside “reuse the current stack” guidance and repeated overlapping shared-infra advice.
- The duplicate `Final Summary` observation is a real product bug in the TUI input loop: `readKeypress()` rendered the screen once on entry and then rendered the exact same screen again when `ENTER` resolved, which is harmless in a real terminal but duplicates the final screen in transcript/log captures.
- Telegram diagnostics were directionally correct on `0.3.9`, but the warning text still overstated its evidence by naming “Node or curl” without any in-product curl probe and without pointing to concrete proxy env vars or IPv4/IPv6 routing checks.
- The first verifier pass found one remaining scoped product bug outside the install-summary path: `setup.planPreview` / `reportJson.onboarding.steps` could still include both `Start repo services: \`pnpm dev\`.` and `Some HappyTG services are already running...`.
- The latest local reruns show Telegram environment drift on the maintainer machine: the builder baseline captured a warning-only Node timeout + PowerShell validation split, while the fresh verifier state now shows Node timeout plus PowerShell `401 Unauthorized`. The product classification remains truthful in both cases.
- Codex websocket `403 Forbidden` is a legitimate warning on this machine, not a blocking failure: direct smoke output in `raw/codex-smoke.txt` shows repeated websocket `403` retries, explicit `falling back to HTTP`, final `OK`, and exit code `0`.
- The Mini App `3001` case remains a legitimate external conflict with Docker container `contacts-frontend`; it should stay as a warning with concrete override guidance.
- `pnpm happytg install --json` against the exact current workspace now truthfully fails early on a dirty checkout (`raw/install-json-final.txt`). This is a real environment/worktree guard unrelated to the scoped diagnostics fixes, so the scoped final-summary path was verified with `--dirty-worktree keep`.
- Running bootstrap tests writes `.happytg/state/install-draft.json`; this is an existing test-harness side effect outside the frozen product scope. The stale draft was removed before capturing final installer artifacts so proof evidence reflects the real current workspace instead of a temp test repo.

## Root Cause Analysis

### Telegram diagnostics

- Classification: legitimate environment warning plus product wording bug.
- Baseline raw evidence:
  - `raw/telegram-probe.txt` shows no proxy env vars, WinHTTP direct access, DNS `A` and `AAAA` records for `api.telegram.org`, IPv4 direct TCP timeout, IPv6 direct TCP unroutable, Node `fetch` timeout with `UND_ERR_CONNECT_TIMEOUT`, and a successful PowerShell Bot API `getMe` validation for `@gerta_workbot`.
- Fresh verifier-state evidence:
  - `raw/telegram-probe-final.txt` shows the same Node `UND_ERR_CONNECT_TIMEOUT`, but PowerShell now returns `401 Unauthorized`, which moves the current machine from warning-only transport split to a real `invalid_token` classification.
- Root cause:
  - The failing layer is external to HappyTG: the same token succeeds through Windows PowerShell Bot API HTTPS but times out through Node fetch/undici on this host.
  - The product bug was in the wording: it mentioned “Node or curl” without curl evidence and did not name the concrete proxy env vars or the IPv4/IPv6 routing angle.
- Current-state nuance:
  - The machine state changed during the task, so the latest install reruns now truthfully classify Telegram as `invalid_token`. The earlier warning-only transport split is still locked by `raw/telegram-probe.txt`, `raw/install-json.txt`, and passing regression tests.
- Fix:
  - `packages/bootstrap/src/install/telegram.ts` now says “Node HTTPS/undici transport”, points to `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY`, mentions WinHTTP proxy differences, and calls out IPv4/IPv6 routing checks.

### Codex websocket `403 Forbidden`

- Classification: legitimate environment warning that should remain visible.
- Baseline raw evidence:
  - `raw/codex-smoke.txt` shows repeated websocket `403 Forbidden`, then `codex_core::client: falling back to HTTP`, final `OK`, and exit code `0`.
  - `raw/doctor-json-final.txt` and `raw/verify-json-final.txt` still surface only the warning-level message: “Codex Responses websocket returned 403 Forbidden, then the CLI fell back to HTTP.”
- Root cause:
  - The websocket endpoint is returning `403` on this maintainer machine, but the CLI remains usable through HTTP fallback.
  - No additional product classification bug was found on current HEAD; the scoped product issue around Codex was downstream summary noise, not websocket severity.
- Fix:
  - No change to websocket severity logic was required.
  - The final install summary now avoids contradictory next-step guidance around that warning by removing conflicting `pnpm dev` instructions when the stack is already running.

### Final Summary / Next steps duplication

- Classification: real product bug.
- Root cause 1:
  - `packages/bootstrap/src/install/tui.ts` re-rendered the exact same final screen again when `ENTER` resolved `waitForEnter()`.
- Root cause 2:
  - `packages/bootstrap/src/install/index.ts` always seeded final `nextSteps` with `pnpm dev`, then appended post-check plan items that could already say “Some HappyTG services are already running”.
  - Semantic dedupe handled pairing-related overlap but not running-stack/shared-infra overlap.
- Root cause 3:
  - `packages/bootstrap/src/index.ts` still built `setup` / `doctor` / `verify` onboarding steps through `buildSetupPlan()` with `Start repo services: \`pnpm dev\`.` before checking whether HappyTG services were already running.
- Fix:
  - `waitForEnter()` now returns immediately on the confirm key instead of repainting the same screen.
  - Next-step semantic keys now collapse overlapping shared-infra / Redis / running-stack advice and remove `pnpm dev` when a running-stack warning is already present.
  - `buildSetupPlan()` now checks occupied HappyTG ports before adding the start step, and `packages/bootstrap/src/index.test.ts` locks that shared onboarding behavior.

### Mini App port `3001`

- Classification: legitimate environment warning.
- Raw evidence:
  - `raw/doctor-json-final.txt`, `raw/verify-json-final.txt`, and `raw/install-json-keep-final.txt` consistently attribute port `3001` to Docker container `contacts-frontend`.
- Fix:
  - No suppression. The warning remains, but the final install `nextSteps` now mention the port override once instead of mixing it with contradictory startup guidance.

## Code Changes

- `packages/bootstrap/src/install/index.ts`
  - added semantic keys for shared-infra/running-stack advice
  - suppresses `pnpm dev` once post-checks already confirm a running HappyTG stack
- `packages/bootstrap/src/index.ts`
  - removes the shared onboarding contradiction in `buildSetupPlan()` when HappyTG services are already running
- `packages/bootstrap/src/install/telegram.ts`
  - tightened Node/undici transport wording and named concrete proxy/routing checks
- `packages/bootstrap/src/install/tui.ts`
  - stopped re-rendering the same final screen on confirm
- `packages/bootstrap/src/index.test.ts`
  - added regression coverage for setup/onboarding plans when HappyTG services are already running
- `packages/bootstrap/src/install.runtime.test.ts`
  - added regression coverage for contradictory running-stack next steps
  - stubs `writeInstallDraft` in the new test so the test does not mutate local installer state
- `packages/bootstrap/src/install.test.ts`
  - added regression coverage for final-screen non-duplication
  - tightened Telegram wording assertions
- release metadata
  - aligned workspace package versions to `0.3.10`
  - added `docs/releases/0.3.10.md`
  - updated `CHANGELOG.md`

## Acceptance Mapping

- AC1 Telegram diagnostics:
  - satisfied by `packages/bootstrap/src/install/telegram.ts`, `packages/bootstrap/src/install.test.ts`, `raw/telegram-probe.txt`, `raw/telegram-probe-final.txt`, and installer/raw regression evidence
- AC2 Codex warnings:
  - satisfied by `raw/codex-smoke.txt`, `raw/doctor-json-final.txt`, `raw/verify-json-final.txt`, and the unchanged warning-level websocket fallback wording in product output
- AC3 Summary / next steps / final screen:
  - satisfied by `packages/bootstrap/src/install/index.ts`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/install/tui.ts`, `packages/bootstrap/src/install.runtime.test.ts`, `packages/bootstrap/src/install.test.ts`, `packages/bootstrap/src/index.test.ts`, and the post-fix raw outputs
- AC4 Mini App `3001`:
  - satisfied by `raw/doctor-json-final.txt`, `raw/verify-json-final.txt`, and `raw/install-json-keep-final.txt`
- AC5 Regression coverage:
  - satisfied by `raw/test-bootstrap.txt`, `raw/test-unit.txt`, and the new scoped bootstrap/install/index tests
- AC6 Proof bundle:
  - satisfied by `verdict.json`, `problems.md`, `task.json`, `raw/task-validate.txt`, and the canonical raw artifact set under `raw/`
