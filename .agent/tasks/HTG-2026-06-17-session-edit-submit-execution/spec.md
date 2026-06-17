# HTG-2026-06-17-session-edit-submit-execution

## Problem

When an operator opens an existing session, chooses a question/task follow-up, enters a prompt, and submits it, the UI appears to do nothing. The expected behavior is that the request is accepted, executable work starts through the existing control plane, and the operator is taken to the created/running session detail.

## Scope

- Create a reusable repair prompt at `.agent/prompts/happytg-session-edit-submit-execution-fix.md`.
- Reproduce the Mini App session-detail follow-up path through tests.
- Fix the minimum necessary Mini App routing/form/auth-context behavior.
- Preserve existing Codex Desktop `Continue` semantics.
- Prepare release metadata and publish only after verification and merge.

## Acceptance Criteria

1. `/session/:id?userId=...` renders follow-up links that preserve `userId`.
2. Legacy `/?screen=session&id=...&userId=...` renders the same preserved follow-up context.
3. `/project/:id?userId=...` question/new-task links preserve `userId` where direct context is present.
4. Submitting `/new-task?userId=...` from a session context posts through `/api/v1/miniapp/sessions?userId=...`.
5. The generated follow-up prompt includes `Context session: <id>.`.
6. The response contains a session detail href and the client can navigate to it.
7. Focused Mini App tests, typecheck, lint, build, release metadata validation, and task validation are recorded under `raw/`.

## Constraints

- Do not touch unrelated pending work from the main worktree.
- Do not change Telegram event transport.
- Do not weaken policy/approval rules.
- Do not collapse `Resume`, `Continue`, and `New Task` into one action.
- Keep changes small and reviewable.

## Verification Plan

- `pnpm --filter @happytg/miniapp test`
- `pnpm --filter @happytg/miniapp typecheck`
- `pnpm --filter @happytg/miniapp lint`
- `pnpm --filter @happytg/miniapp build`
- `pnpm release:check --version 0.4.29`
- `pnpm happytg task validate --repo . --task HTG-2026-06-17-session-edit-submit-execution`

## Phase Status

- `init`: complete
- `freeze/spec`: complete
- `build`: pending
- `evidence`: pending
- `fresh verify`: pending
- `minimal fix`: pending
- `fresh verify`: pending
- `complete`: pending
