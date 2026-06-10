# HTG-2026-06-10-miniapp-session-ui

## Scope

Refresh the Telegram Mini App visual interface for session-driven project work. Keep the change scoped to the Mini App render layer and tests unless validation proves a backend contract issue.

## User Goal

- Make the Mini App maximally functional but convenient.
- Remove or hide excess technical information.
- Make it easy to see the result of a project session.
- Make it easy to ask implementation tasks and questions from the Mini App.

## Acceptance Criteria

1. The main Mini App session/project views emphasize result, next action, and task/question entry before technical metadata.
2. Long paths, raw payloads, event JSON, and verbose operational details are hidden behind progressive disclosure or removed from the primary scan path.
3. The new-task form supports both implementation tasks and implementation questions without changing backend architecture contracts.
4. Codex Desktop and Codex CLI source-aware flows remain intact, including recent Desktop session detail and disabled unsupported actions.
5. Existing auth/session handling, Mini App base-path link prefixing, and no-raw-secret rendering behavior remain covered by tests.
6. Validation evidence is recorded under this task bundle.

## Non-Goals

- Do not turn Telegram into an internal event transport.
- Do not change policy, approval, queueing, or runtime-adapter semantics.
- Do not introduce a frontend framework rewrite.
- Do not expose raw prompts, raw logs, secrets, or credentials.

## Ten-Role Critical Review Baseline

1. Product owner: result visibility and task/question entry must be obvious in the first screen.
2. Mobile UX reviewer: small Telegram viewport must not be crowded by secondary metadata.
3. Accessibility reviewer: controls must keep labels, touch targets, and readable contrast.
4. Frontend engineer: keep SSR string rendering maintainable and avoid broad rewrites.
5. Backend contract reviewer: stay within existing `quick`/`proof` session contracts.
6. Security reviewer: hide raw payloads and do not add secret-bearing memory or artifacts.
7. Runtime reviewer: preserve Codex Desktop unsupported-action behavior.
8. QA reviewer: update focused Mini App tests and run the smallest relevant checks.
9. Release reviewer: branch, commit, push, and release only after clean verification.
10. Graphify reviewer: update or record scoped graph evidence after the Mini App changes.

## Expected Files

- `apps/miniapp/src/index.ts`
- `apps/miniapp/src/index.test.ts`
- `.agent/tasks/HTG-2026-06-10-miniapp-session-ui/*`

