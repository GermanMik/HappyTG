# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before any production edit
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed with independent verifier pass
- `complete`: completed

## Commands Run

### Proof-loop setup

- `pnpm happytg task status --repo . --task HTG-2026-04-19-install-summary-pairing-dev-warning-triage` -> `raw/task-status.txt`
- final `pnpm happytg task status --repo . --task HTG-2026-04-19-install-summary-pairing-dev-warning-triage` -> `raw/task-status-final.txt`
- final `pnpm happytg task validate --repo . --task HTG-2026-04-19-install-summary-pairing-dev-warning-triage` -> `raw/task-validate.txt`

### Baseline machine reproduction

- `pnpm happytg setup --json` -> `raw/setup-json.txt`
- `pnpm happytg doctor --json` -> `raw/doctor-json.txt`
- `pnpm happytg verify --json` -> `raw/verify-json.txt`
- `pnpm happytg install --json --repo-mode current --repo-dir . --background manual --post-check setup --post-check doctor --post-check verify` -> `raw/install-json.txt`
- `pnpm daemon:pair` -> `raw/daemon-pair.txt`
- `Invoke-RestMethod http://127.0.0.1:4000/api/v1/hosts` -> `raw/hosts.json`
- `pnpm --filter @happytg/api run start` -> `raw/dev-api-start.txt`
- `pnpm dev:api` -> `raw/dev-api.txt`

### Repo verification

- `pnpm build` -> `raw/build.txt`
- `pnpm lint` -> `raw/lint.txt`
- `pnpm typecheck` -> `raw/typecheck.txt`
- `pnpm test` -> `raw/test-unit.txt`
- `pnpm --filter @happytg/bootstrap test` -> `raw/test-integration.txt`

### Supporting raw summaries

- process env probe -> `raw/env-summary.json`
- local daemon state summary -> `raw/daemon-state-summary.json`
- extracted Codex smoke stderr/stdout -> `raw/codex-smoke.txt`

## Current Machine Facts

- `setup`, `doctor`, and `verify` all return `status: warn`, with the same two findings only:
  - `CODEX_SMOKE_WARNINGS`
  - `SERVICES_ALREADY_RUNNING`
- The running-stack finding consistently reports HappyTG services already running on `3007`, `4000`, `4100`, and `4200`, with API `4000` attributed to HappyTG API via Docker container `infra-api-1`.
- The install flow in the current tree does not end with a placeholder `/pair <CODE>` handoff. It refreshed a real pairing code and rendered `Send \`/pair 3U1DKL\` to @gerta_workbot.` in `raw/install-json.txt`.
- A direct `pnpm daemon:pair` run also issued a real code (`S2HVBC`), wrote `C:\Users\tikta\.happytg\daemon-state.json`, and the API reported the host in `registering` state in `raw/hosts.json`.
- A one-shot API start on an already-occupied API port prints the reuse-path message and exits cleanly instead of failing with raw `EADDRINUSE`.

## Classification And Root Cause

### 1. Codex websocket `403 Forbidden`

- Classification: `legitimate environment warning` with `external dependency issue` characteristics
- Why:
  - `raw/codex-smoke.txt` and the `reportJson.codex` blocks in `raw/setup-json.txt`, `raw/doctor-json.txt`, and `raw/verify-json.txt` show repeated websocket `403 Forbidden` responses, then `codex_core::client: falling back to HTTP`.
  - The bootstrap reports mark `smokeOk: true` and keep the finding at `severity: "warn"`, not `error`.
  - `packages/runtime-adapters/src/index.ts` explicitly summarizes this condition as `Codex Responses websocket returned 403 Forbidden, then the CLI fell back to HTTP.` when fallback happens.
- Conclusion:
  - Current product behavior is truthful. The warning is real on this machine, but it is not blocking because the smoke request completes over HTTP fallback.

### 2. `/pair CODE` after install summary

- Classification: `false_positive_current_tree`, corresponding to a previously fixed product-path issue rather than a live current bug
- Why:
  - Current install output in `raw/install-json.txt` does not instruct the user to run `/pair <CODE>` without a code. It auto-refreshes a real code first, then renders a concrete Telegram handoff.
  - `raw/daemon-pair.txt` proves the execution host can issue a concrete code and persist host state locally.
  - `raw/hosts.json` proves the API knows the host and tracks it as `registering`, which is exactly the state that should lead to refresh-and-handoff rather than reuse.
  - `packages/bootstrap/src/install/pairing.ts` models three distinct decisions:
    - no local host -> request code automatically
    - existing paired/active host -> reuse
    - existing registering/stale/revoked/not-found host -> refresh code automatically
  - `packages/bootstrap/src/install/index.ts` turns only the successful auto-request/refresh path into a concrete `/pair CODE` message.
  - `apps/bot/src/handlers.ts` keeps the actual claim boundary in Telegram `/pair <PAIRING_CODE>`, so install only automates code issuance and handoff, not claim completion.
- Conclusion:
  - The current product no longer promises an unreachable state here. The reported "non-working `/pair CODE` after install summary" is not reproducible on the current builder machine and maps to an already-fixed/stale symptom, not a live regression.

### 3. Dev/reuse path and already-running API interaction

- Classification: `legitimate_reuse_path`, not a current product bug
- Why:
  - `raw/setup-json.txt`, `raw/doctor-json.txt`, and `raw/verify-json.txt` all classify API `4000` as `occupied_expected` and attribute it to HappyTG API.
  - `raw/dev-api-start.txt` and `raw/dev-api.txt` show the runtime message `Port 4000 already has a HappyTG API. Reuse the running API if it is yours, or start a new one with HAPPYTG_API_PORT/PORT, then try again.`
  - `apps/api/src/index.ts` implements the fast path:
    - same HappyTG API on port -> reuse
    - other HappyTG service -> actionable conflict
    - foreign process -> actionable conflict
    - transient handoff -> retry before final classification
  - `raw/test-unit.txt` includes the API tests that lock reuse/conflict/transient-handoff behavior.
- Conclusion:
  - The current dev/reuse path is truthful and state-machine-correct on the builder machine. The already-running API interaction is not the root cause of a live failure here.

### 4. Turbo update notice

- Classification: `unrelated_or_not_reproduced`
- Why:
  - Fresh `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, and `raw/test-unit.txt` show only the normal Turbo banner (`turbo 2.9.3`) and task execution summary.
  - No `update available`, `turborepo update`, or similar notice appears in any current raw artifact under this task.
- Conclusion:
  - There is no evidence that a Turbo update notice is related to the pairing or API reuse symptoms in the current reproduction set.

## Current Fix Decision

- Additional production-code change in this task: not required
- Reason:
  - The current worktree already behaves according to the frozen acceptance criteria for the investigated paths.
  - The only live warnings reproduced are truthful current-environment warnings, not product regressions.
  - Inventing a code change here would violate the proof-first rule by "fixing" a symptom that current evidence does not reproduce.

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Codex websocket 403 is classified with repo-local evidence | `raw/setup-json.txt`, `raw/doctor-json.txt`, `raw/verify-json.txt`, `raw/codex-smoke.txt`, `packages/runtime-adapters/src/index.ts` |
| `/pair CODE` install-summary handoff root cause is proven | `raw/install-json.txt`, `raw/daemon-pair.txt`, `raw/hosts.json`, `packages/bootstrap/src/install/pairing.ts`, `packages/bootstrap/src/install/index.ts`, `apps/bot/src/handlers.ts` |
| Dev/reuse path versus already-running API is proven | `raw/setup-json.txt`, `raw/doctor-json.txt`, `raw/verify-json.txt`, `raw/dev-api.txt`, `raw/dev-api-start.txt`, `apps/api/src/index.ts`, `raw/test-unit.txt` |
| Turbo notice is classified as related or unrelated | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-unit.txt` |
| Current-fix decision is justified without hiding real warnings | all classification sections above |
| Repo verification remains green | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-unit.txt`, `raw/test-integration.txt` |

## Residual Risk

- The task proves code issuance, host state persistence, and Telegram bot validation, but it does not perform a live Telegram chat claim. The actual `/pair CODE` claim boundary remains outside repo-local automation.
- Codex plugin sync and Codex state DB warnings remain visible in `raw/codex-smoke.txt`. They are environment/runtime noise adjacent to the websocket `403`, but the frozen task scope required classification of the websocket warning itself, not a broader Codex local-state cleanup.

## Final Verifier Outcome

- Independent verifier: agent `019da5b7-122a-7db0-bbea-734101652d97`
- Verifier run id: `verifier-2026-04-19T15:35:41.5808587+03:00`
- Result:
  - no remaining scoped findings
  - no current product fix required
  - bundle classifications are supported by current code paths plus fresh scoped reruns
  - final task CLI state is `Phase: complete` and `Verification: passed`
