# HTG-2026-05-03 UX 10-Role Prompt Spec

Status: frozen before repository artifact changes.
Branch: `codex/happytg-ux-10-role-prompt-release`

## Goal

Create a repo-grounded execution prompt for a future comprehensive HappyTG usability/design audit and implementation pass. The prompt must optimize the project so it becomes as simple and convenient as possible to use in both the Telegram Mini App and Telegram Bot.

## Scope

- Add a reusable prompt artifact under project documentation.
- The prompt must require input from 10 independent roles before implementation decisions.
- The prompt must cover both Mini App and Bot flows.
- The prompt must require evidence, proof-loop discipline, source/runtime safety, accessibility, mobile ergonomics, Telegram constraints, tests, release handling, and EchoVault memory.
- Add release metadata for this prompt artifact because `0.4.10` is already published and this repository change needs a new release.

## Non-Goals

- Do not redesign or modify Mini App/Bot production UI in this task.
- Do not invent unsupported runtime/control contracts.
- Do not relax project invariants: Telegram is not internal agent-event transport, mutating host operations stay serialized, policy evaluation precedes approval evaluation, higher-level policy cannot be weakened by lower-level overrides, and heavy runtime initialization stays lazy/cache-aware.

## Expected Artifacts

- `docs/prompts/happytg-ux-10-role-optimization.md`
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/evidence.md`
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/evidence.json`
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/problems.md`
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/verdict.json`
- `.agent/tasks/HTG-2026-05-03-ux-10-role-prompt/raw/*`
- Version/release docs for the new release.

## Verification

Run and capture, where available:

- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg verify`
- `pnpm release:check --version 0.4.11`
- `pnpm happytg task validate --repo . --task HTG-2026-05-03-ux-10-role-prompt`
- Fresh verifier pass over spec, evidence, verdict, changed files, and release metadata.

## Acceptance Criteria

- Prompt is specific enough for an agent to audit and implement UX improvements without further clarification.
- Prompt includes 10 role perspectives and a synthesis protocol so roles cannot collapse into one generic opinion.
- Prompt explicitly separates Mini App and Bot UX surfaces and requires source/runtime-aware flows.
- Prompt encodes project invariants and proof-loop/release/memory obligations.
- Release metadata validates for `0.4.11`.
- PR is merged, task branch is cleaned up, release is published, proof bundle and memory are saved.
