# HTG-2026-06-10-desktop-session-continuation Spec

## Scope

- Add a real Codex Desktop continuation path for an existing app-server thread from Mini App detail.
- Keep Desktop mutating actions serialized and policy-checked through the existing API service.
- Add a prompt field on Desktop session detail so a user can send a follow-up request into the existing session.
- Add Mini App ordering controls for the Codex session/answer list without changing raw history storage.
- Preserve existing New Desktop Task and bounded history behavior.

## Non-goals

- Do not make Telegram the internal transport for Desktop events.
- Do not import Desktop threads into HappyTG-owned CLI session state.
- Do not add process-kill or fake-success Desktop controls.
- Do not rewrite the Mini App layout or API authentication model.

## Acceptance Criteria

- Existing Desktop `Resume` no longer has to be used as the only way to continue work with a new request.
- Desktop session detail contains a follow-up prompt form that posts to a dedicated continuation endpoint.
- Continuation sends the prompt to the existing Codex Desktop thread through app-server `turn/start`.
- API validates non-empty prompt, checks user auth, applies existing Codex Desktop policy/audit/serialized mutation path, and returns a bounded result.
- Codex list view supports deterministic ordering through a query parameter and renders a visible sort control.
- Tests cover continuation payloads/routes and sort rendering/order.
- Relevant validation logs are saved under `raw/`.

## 10-role Critical Review

- Product owner: continuing an old session requires a user prompt field, not only a generic `Resume` button.
- UX designer: the follow-up control belongs on Desktop session detail near history/actions and must show clear feedback.
- API engineer: continuation needs a distinct endpoint because `thread/resume` and `turn/start` are different app-server operations.
- Runtime engineer: app-server availability must remain truthful; no fallback to unsupported contracts or process control.
- Security engineer: prompt continuation is a mutating action, so it must preserve policy checks, audit records, user auth, and serialized queue.
- QA engineer: sort order and continuation behavior need unit tests with deterministic timestamps.
- Release engineer: changes need proof artifacts, validation logs, commit, push, PR/release path.
- Maintainer: keep the patch narrow in `protocol`, `runtime-adapters`, `api`, and `miniapp`; avoid broad refactors.
- Operator: when app-server is unavailable, the UI/API should return existing structured unsupported/unavailable errors.
- Future agent: record the durable decision in EchoVault and project evidence so later sessions understand why `Resume` is not enough.

## Expected Files

- `packages/protocol/src/index.ts`
- `packages/runtime-adapters/src/codex-desktop.ts`
- `packages/runtime-adapters/src/index.test.ts`
- `apps/api/src/service.ts`
- `apps/api/src/index.ts`
- `apps/api/src/service.test.ts`
- `apps/api/src/index.test.ts`
- `apps/miniapp/src/index.ts`
- `apps/miniapp/src/index.test.ts`
- `.agent/tasks/HTG-2026-06-10-desktop-session-continuation/*`

## Frozen At

2026-06-10
