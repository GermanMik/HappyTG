# HTG-2026-04-19-startup-port-proof-loop

## Status

- Phase: freeze/spec
- Scope frozen before production edits: yes
- Task type: startup bug fix with proof-loop evidence

## Problem Statement

`pnpm dev` currently reports misleading startup failure behavior when expected service ports are already occupied:

- `@happytg/worker:dev` crashes with a raw Node `Error: listen EADDRINUSE: address already in use :::4200`
- `@happytg/bot:dev` reports `Bot failed to start` with raw `listen EADDRINUSE` detail for port `4100`
- `@happytg/api:dev` already classifies occupied port `4000` truthfully
- `@happytg/miniapp:dev` already classifies occupied port `3007` truthfully in the reported repro

The task is to remove the false/raw startup-failure path for occupied ports while preserving the existing product model of supported reuse versus actionable conflict.

## Frozen Scope

### In scope

- Reproduce the current `pnpm dev` startup issue and save raw output under this task bundle.
- Inspect and ground the decision in:
  - `apps/worker/src/index.ts`
  - `apps/bot/src/index.ts`
  - `apps/api/src/index.ts`
  - `apps/miniapp/src/index.ts`
  - `packages/bootstrap/src/index.ts`
  - `docs/quickstart.md`
  - `docs/troubleshooting.md`
  - existing startup/port-conflict tests around these services
- For `worker`, implement the minimal local fix needed to replace bare `server.listen(...)` failure with product-level occupied-port classification covering:
  - free port -> listen normally
  - same HappyTG worker already listening -> reuse with clear log
  - different HappyTG service listening -> conflict with clear log
  - third-party process listening -> conflict with clear log
- Reuse the existing message style from `apps/api` and `apps/miniapp` rather than inventing a new UX model.
- Determine the correct expected behavior for `bot` by proving it from code, tests, and docs before changing bot behavior.
- If `bot` requires a fix to align with the proven model, make only the minimal consistent change.
- Add or update targeted tests so reuse/conflict cases are covered, not just happy-path startup.
- Keep docs truthful if runtime behavior changes or existing docs are ambiguous for this scenario.
- Produce the full proof bundle:
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
  - `raw/build.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/lint.txt`
  - additional raw artifacts as needed for repro and fresh verify

### Out of scope

- Any fallback that silently moves services to other ports
- Broad shared startup-framework refactors across packages
- Semantics changes for `HAPPYTG_*_PORT` or `PORT`
- Unrelated startup cleanup outside the occupied-port bug path
- Documentation rewrites unrelated to truthful occupied-port behavior

## Constraints

- Do not hide port conflicts behind a generic catch-all startup error.
- Do not break supported reuse when the same HappyTG service is already running.
- Do not assume Mini App uses default `3001`; the repro explicitly shows `3007`.
- Keep fixes minimal and local unless code inspection proves a wider change is necessary.

## Acceptance Criteria

1. Repro evidence exists showing the pre-fix `worker` raw `EADDRINUSE` stack trace and the current `bot` occupied-port behavior from a real run or faithful targeted repro.
2. `worker` no longer emits a raw Node `EADDRINUSE` stack trace on the expected occupied-port path.
3. `worker` distinguishes free, same-service reuse, different-HappyTG-service conflict, and third-party conflict with actionable logs aligned to existing `api`/`miniapp` wording.
4. `worker` does not silently change ports and still respects current port env semantics.
5. `bot` behavior is explicitly classified in this task:
   - either no code change, with evidence explaining why its current or adjusted behavior is correct;
   - or minimal code/test/doc updates that bring it into the proven expected model.
6. Relevant tests cover reuse/conflict startup behavior for changed services.
7. Proof artifacts record builder verification and a fresh verifier pass separately.

## Investigation Result Before Build

- `worker` is confirmed as the primary bug:
  - `apps/worker/src/index.ts` calls bare `server.listen(port, ...)` in the CLI path.
  - pre-fix repro in `raw/pre-fix-worker-dev.txt` shows a raw unhandled Node `EADDRINUSE` stack trace even when the occupied port belongs to a same-service HappyTG worker probe.
- `bot` is also in the same product contract and therefore needs a scoped startup fix:
  - `apps/bot/src/index.ts` exposes `/health` and `/ready` with `service: "bot"`, so the service is fingerprintable in the same way as `api` and `miniapp`.
  - `packages/bootstrap/src/index.ts` includes `bot` and `worker` in `criticalPortDefinitions`, marks same-service HTTP occupants as `occupied_expected`, and folds `miniapp`, `api`, `bot`, and `worker` together into `SERVICES_ALREADY_RUNNING` with the action `Reuse the running stack or stop it before starting another copy.`
  - `docs/bootstrap-doctor.md` documents that state at the running-stack level.
  - pre-fix repro in `raw/pre-fix-bot-dev.txt` shows that runtime currently logs `Bot failed to start` with raw `listen EADDRINUSE` detail instead of honoring that reuse-vs-conflict model.
- Therefore the frozen expectation for this task is:
  - `worker`: support same-service reuse and explicit conflict classification.
  - `bot`: support the same reuse-vs-conflict classification model rather than only a generic occupied-port error.

## Verification Plan

- Pre-fix repro and raw capture
- Targeted tests for touched services/packages
- Fresh verification commands after build:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm happytg verify`
- If a full command is too heavy or blocked, record exactly what ran and why

## Notes To Verifier

- Pay special attention to whether `bot` was changed without enough proof that reuse is intended.
- Reject any solution that resolves the symptom by changing default ports or by swallowing occupied-port errors without classification.
