# HappyTG Session Edit Submit Execution Fix

Use this prompt when the Mini App lets an operator open an existing session, choose `Задать вопрос` or `Новая задача`, enter a prompt, submit it, and then no visible execution starts.

## Goal

Fix the session-detail follow-up flow so a submitted question or task reliably creates and dispatches executable work.

## Required Context

- Run `memory context --project` and search EchoVault for prior HappyTG Mini App / Codex Desktop continuation work.
- Read `AGENTS.md`, `docs/memory/README.md`, and relevant project memory before edits.
- Use `graphify query` or targeted `rg` before broad source exploration.
- Preserve the distinction between:
  - Codex CLI session follow-up: creates a new Mini App session / pending dispatch.
  - Codex Desktop continue: posts a prompt to `/api/v1/codex-desktop/sessions/:id/continue`.

## Frozen Scope

Investigate and fix only the paths involved in session-detail follow-up submission:

- `/session/:id`
- legacy `/?screen=session&id=...`
- `/new-task`
- `POST /new-task`
- Mini App client-side form submit handlers
- Mini App tests and proof artifacts

Do not redesign runtime adapters, approval policy, host-daemon execution, Telegram transport, or Codex Desktop app-server contracts unless direct evidence shows they are the root cause.

## Acceptance Criteria

1. From a session detail opened with direct Mini App context, `Задать вопрос` and `Новая задача` links preserve the same request user context.
2. Submitting the follow-up form posts to the Mini App server, returns a JSON success payload, and navigates to the created session detail.
3. The created Codex CLI session keeps the original session id in the generated prompt context.
4. The server-side path still creates a `pendingDispatch` through the existing API service; no Telegram internal transport is introduced.
5. Codex Desktop `Continue` remains a prompt-bearing `codex_desktop_continue` action and is not confused with `Resume` or new CLI sessions.
6. Regression tests cover the broken session-detail follow-up path.
7. Relevant Mini App validation commands pass, and release metadata is updated only if a release is requested.

## Proof Loop

1. Freeze the task spec before production edits.
2. Add or update focused regression tests first when feasible.
3. Implement the minimum Mini App fix.
4. Run scoped tests/typecheck/lint/build for affected packages.
5. Run a fresh verifier pass from proof artifacts.
6. If release is requested, update versions, `CHANGELOG.md`, `docs/releases/<VERSION>.md`, run `pnpm release:check --version <VERSION>`, merge, then publish through the guarded GitHub Release workflow.

## Non-Goals

- Do not bypass Mini App auth.
- Do not weaken policy or approval evaluation.
- Do not make Telegram the internal transport for agent events.
- Do not add Ollama configuration or cloud-only runtime assumptions.
