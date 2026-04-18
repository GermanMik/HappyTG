# Task Spec

Task ID: `HTG-2026-04-18-dev-port-conflict-triage`

## Task Spec

Stabilize `pnpm dev` startup behavior for occupied-port scenarios without masking real environment problems.

Current confirmed startup behavior on Windows PowerShell:

- `@happytg/miniapp` already converts `EADDRINUSE` on port `3001` into a short actionable product message.
- `@happytg/api` still performs a bare `server.listen(...)` at module entry and crashes with a raw unhandled Node `EADDRINUSE` stack trace when port `4000` is occupied.
- `@happytg/bot` can independently log repeated `Telegram polling cycle failed` with `detail:"fetch failed"` even when reproduced outside the API port-conflict scenario.

This task will:

- make the API occupied-port startup path productized and actionable;
- distinguish a legitimate already-running HappyTG API from a foreign listener on the same port;
- keep explicit port override semantics unchanged for `HAPPYTG_API_PORT`, `HAPPYTG_MINIAPP_PORT`, and `PORT`;
- keep bot polling diagnostics truthful and separate from the API port-conflict root cause unless evidence proves a direct coupling;
- align runtime UX and documentation for `3001` and `4000` without broad refactoring.

## Problem

HappyTG already has a repo-level model for port triage in `packages/bootstrap`: HTTP listeners are probed via `/ready` and `/health`, and `body.service` is used to distinguish:

- `occupied_expected`: the expected HappyTG service is already running;
- `occupied_external`: some other listener occupies the port.

`apps/miniapp` also handles `EADDRINUSE` as a product scenario by trapping the listen error and surfacing a friendly message. `apps/api` does not yet do this. As a result, `pnpm dev` currently mixes three different concerns into one noisy failure surface:

- a legitimate occupied-port state that may mean "your HappyTG API is already running";
- a real foreign-process conflict on `4000`;
- an independent bot-to-Telegram transport failure that is not proven to share the same root cause.

That is a product bug, not just a local environment quirk, because the API startup path currently exposes a raw Node exception instead of a deterministic HappyTG diagnostic, while the codebase already contains the primitives and product precedent needed to classify the state correctly.

## Acceptance Criteria

1. `pnpm dev` no longer fails with a raw unhandled Node `EADDRINUSE` stack trace from `apps/api/src/index.ts` when the API port is occupied.

2. API occupied-port behavior becomes productized and actionable:
   - if the listener on the configured API port is a live HappyTG API, the user gets a deterministic reuse-oriented message;
   - if the listener is not the HappyTG API, the user gets a deterministic conflict-oriented message;
   - both paths avoid raw stack traces and preserve manual override guidance via `HAPPYTG_API_PORT` / `PORT`.

3. The chosen API UX is documented and justified relative to the existing Mini App behavior:
   - UX logic for `3001` and `4000` is consistent in principle;
   - exact behavior does not need to be identical if there is a documented architectural reason.

4. Bot polling warnings are treated as a separate concern unless implementation-time evidence proves direct causality:
   - they may remain after the API fix if they are still truthful;
   - if their presentation changes, the evidence must show why.

5. Regression coverage is added for the API startup conflict path, at minimum covering:
   - occupied port with an already-running HappyTG API fingerprint;
   - occupied port with a foreign listener;
   - no raw `EADDRINUSE` stack trace escaping the productized path.

6. Only the minimum necessary code/docs/tests are changed to satisfy the startup diagnostics problem.

7. The proof bundle for this task is complete and contains real artifacts, including:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
   - `raw/repro-pnpm-dev.txt`
   - `raw/port-3001.txt`
   - `raw/port-4000.txt`
   - `raw/api-conflict-before.txt`
   - `raw/api-conflict-after.txt`
   - `raw/bot-polling-before.txt`
   - `raw/bot-polling-after.txt`
   - `raw/task-validate.txt`

## Constraints

- Freeze this spec before any production-code edits.
- Follow the repo proof-loop: `init`, `freeze/spec`, `build`, `evidence`, `fresh verify`, `minimal fix`, `fresh verify`, `complete`.
- Use read-only parallelism only for investigation; all writes and code edits must be serialized after spec freeze.
- If role separation is available, use separate builder/verifier/fixer responsibilities.
- Verifier must not edit production code.
- Fixer must change only the minimum necessary scope.
- Do not hide legitimate environment issues by silently picking a different default port.
- Do not weaken explicit env override behavior for `HAPPYTG_API_PORT`, `HAPPYTG_MINIAPP_PORT`, or `PORT`.
- Do not weaken architecture invariants from `AGENTS.md`.
- Do not treat bot polling `fetch failed` as the same root cause unless verified by evidence.
- Do not introduce unrelated refactors or broad startup-framework churn.
- If API reuse classification is implemented, it must be deterministic, evidence-backed, and covered by tests.

## Verification Plan

1. Capture baseline evidence before changes:
   - record what listens on `3001` and `4000`;
   - capture controlled `pnpm dev` repro output;
   - capture standalone bot polling repro output.

2. Add targeted API tests for occupied-port startup behavior and any shared helper logic introduced for deterministic classification.

3. Run touched-package tests first.

4. Run workspace verification:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`

5. Validate the task bundle:
   - `pnpm happytg task validate --repo . --task HTG-2026-04-18-dev-port-conflict-triage`

6. Perform a fresh post-fix repro and capture:
   - API conflict behavior after the change;
   - bot polling behavior after the change.

7. Complete the task only if the proof bundle shows that:
   - API no longer throws raw unhandled `EADDRINUSE`;
   - the occupied HappyTG API case and foreign conflict case are distinguished truthfully;
   - bot polling is either unchanged as an independent warning or changed with explicit evidence.
