# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed as a separate post-build pass
- `complete`: completed

## Commands Run

### Baseline reproduction

- `pnpm --filter @happytg/worker run dev` with a same-service occupied port override -> `raw/pre-fix-worker-dev.txt`
- `pnpm --filter @happytg/bot run dev` with a same-service occupied port override -> `raw/pre-fix-bot-dev.txt`

### Product-model investigation before edits

- Code inspection:
  - `apps/worker/src/index.ts`
  - `apps/bot/src/index.ts`
  - `apps/api/src/index.ts`
  - `apps/miniapp/src/index.ts`
  - `packages/bootstrap/src/index.ts`
- Docs inspection:
  - `docs/quickstart.md`
  - `docs/troubleshooting.md`
  - `docs/bootstrap-doctor.md`
- Tests inspection:
  - `apps/api/src/index.test.ts`
  - `apps/miniapp/src/index.test.ts`
  - `apps/bot/src/index.test.ts`
  - `apps/worker/src/index.test.ts`
  - `packages/bootstrap/src/index.test.ts`

### Builder verification

- `pnpm --filter @happytg/worker build`
- `pnpm --filter @happytg/bot build`
- `pnpm --filter @happytg/worker typecheck`
- `pnpm --filter @happytg/bot typecheck`
- `pnpm --filter @happytg/worker test`
- `pnpm --filter @happytg/bot test`
- `pnpm --filter @happytg/worker lint`
- `pnpm --filter @happytg/bot lint`
- Artifacts:
  - `raw/build.txt`
  - `raw/typecheck.txt`
  - `raw/test-unit.txt`
  - `raw/lint.txt`
  - `raw/test-integration.txt`

### Post-fix runtime repro

- `pnpm --filter @happytg/worker run dev` with a same-service occupied port override -> `raw/post-fix-worker-dev.txt`
- `pnpm --filter @happytg/bot run dev` with a same-service occupied port override -> `raw/post-fix-bot-dev.txt`

### Fresh verify pass

- `pnpm lint` -> `raw/fresh-verify-lint.txt`
- `pnpm typecheck` -> `raw/fresh-verify-typecheck.txt`
- `pnpm test` -> `raw/fresh-verify-test.txt`
- `pnpm happytg verify` -> `raw/fresh-verify-happytg-verify.txt`
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-startup-port-proof-loop` -> `raw/task-validate.txt`

## Root Cause

- `worker` startup in `apps/worker/src/index.ts` used bare `server.listen(...)` in the CLI path with no `EADDRINUSE` classification, so an occupied port surfaced as an unhandled Node stack trace.
- `worker` also started the runtime tick loop before bind success, so same-service reuse would have risked spinning duplicate local work even if the port bug were papered over.
- `bot` startup in `apps/bot/src/index.ts` wrapped `listen()` in a Promise, but still treated occupied ports as a generic startup failure and surfaced raw `listen EADDRINUSE` text in the log detail.
- Repo-level product evidence showed `bot` and `worker` belong to the same reuse-vs-conflict model as `api` and `miniapp`:
  - `packages/bootstrap/src/index.ts` marks same-service occupants as `occupied_expected` for `bot` and `worker`
  - `docs/bootstrap-doctor.md` documents running-stack reuse for occupied HappyTG service ports
  - both services expose JSON `/health` or `/ready` fingerprints with `service: "bot"` / `service: "worker"`

## Code Changes

- `apps/worker/src/index.ts`
  - added product-level occupied-port startup handling for worker
  - added same-service reuse, different-HappyTG-service conflict, and foreign HTTP listener conflict messaging
  - moved `runtime.start()` onto the successful bind path so reuse does not start a second maintenance loop
  - replaced raw unhandled `EADDRINUSE` failure with an actionable startup message
- `apps/worker/src/index.test.ts`
  - added regression coverage for free-port bind, same-service reuse, different-service conflict, and foreign HTTP listener conflict
- `apps/bot/src/index.ts`
  - added product-level occupied-port startup handling for bot
  - added same-service reuse, different-HappyTG-service conflict, and foreign HTTP listener conflict messaging
  - kept Telegram delivery logic untouched except for skipping polling/webhook startup on same-service reuse
- `apps/bot/src/index.test.ts`
  - added regression coverage for same-service reuse, different-service conflict, foreign HTTP listener conflict, and no-second-loop reuse behavior
- `docs/quickstart.md`
- `docs/troubleshooting.md`
  - added truthful occupied-port guidance for bot `4100` and worker `4200`

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Pre-fix `worker` raw `EADDRINUSE` is reproduced | `raw/pre-fix-worker-dev.txt` |
| Pre-fix `bot` occupied-port behavior is reproduced | `raw/pre-fix-bot-dev.txt` |
| `worker` no longer emits raw Node `EADDRINUSE` on same-service occupied-port path | `apps/worker/src/index.ts`, `raw/post-fix-worker-dev.txt`, `apps/worker/src/index.test.ts` |
| `worker` distinguishes free, same-service reuse, different-service conflict, and foreign listener conflict | `apps/worker/src/index.ts`, `apps/worker/src/index.test.ts` |
| `worker` keeps env semantics and does not silently rebind | `apps/worker/src/index.ts`, `docs/quickstart.md`, `docs/troubleshooting.md` |
| `bot` expected behavior is proven from repo evidence before fix | `spec.md`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/index.test.ts`, `docs/bootstrap-doctor.md` |
| `bot` now follows the same reuse-vs-conflict model | `apps/bot/src/index.ts`, `apps/bot/src/index.test.ts`, `raw/post-fix-bot-dev.txt` |
| Reuse path does not start duplicate bot delivery work | `apps/bot/src/index.ts`, `apps/bot/src/index.test.ts` |
| Documentation stays truthful for occupied ports | `docs/quickstart.md`, `docs/troubleshooting.md` |
| Targeted builder checks pass | `raw/build.txt`, `raw/typecheck.txt`, `raw/test-unit.txt`, `raw/lint.txt` |
| Fresh repo-level verify pass completed | `raw/fresh-verify-lint.txt`, `raw/fresh-verify-typecheck.txt`, `raw/fresh-verify-test.txt`, `raw/fresh-verify-happytg-verify.txt` |

## Residual Risk

- `pnpm happytg verify` still reports an unrelated existing environment warning on this machine: Codex websocket `403 Forbidden` fallback to HTTP. That warning predates this task and stayed untouched.
- Runtime repro artifacts use isolated occupied-port overrides rather than depending on whichever real listeners happen to be present on the builder machine at the moment of the task. The startup path is the same as `pnpm dev`, but the proof is intentionally controlled and deterministic.

## Fresh Verify Outcome

- No new scoped production-code findings were raised after the post-build verify pass.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` all completed successfully.
- `pnpm happytg verify` completed with expected machine warnings unrelated to this bug and showed the running stack as reusable on `3007`, `4000`, `4100`, and `4200`.
- `pnpm happytg task validate --repo . --task HTG-2026-04-19-startup-port-proof-loop` reported `Validation: ok`, `Phase: complete`, and `Verification: passed`.
