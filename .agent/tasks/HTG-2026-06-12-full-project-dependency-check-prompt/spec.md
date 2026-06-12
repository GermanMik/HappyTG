# HTG-2026-06-12-full-project-dependency-check-prompt

## Scope

Add a reusable HappyTG prompt for full-project, dependency-aware verification with proof-loop discipline and mandatory targeted tests after every fix.

## Acceptance Criteria

1. A prompt document exists under `docs/prompts/`.
2. The prompt covers dependency inventory, workspace/runtime/infra/external dependency surfaces, and security dependency checks.
3. The prompt requires proof-loop artifacts, frozen scope, raw evidence, fresh verifier review, and synchronized verdict/state metadata.
4. The prompt requires targeted validation after every fix and a full validation matrix before completion.
5. The prompt preserves HappyTG architecture invariants and LM Studio/no-Ollama policy.
6. The docs-only change is validated with repository-safe checks.

## Non-goals

- No production code changes.
- No dependency, package metadata, lockfile, release metadata, or runtime configuration changes.
- No project-wide test run for this docs-only prompt addition.

## Verification Plan

- Inspect existing prompt/proof-loop docs before writing.
- Add the prompt in the existing `docs/prompts/` style.
- Run `git diff --check`.
- Run `pnpm happytg task validate --repo . --task HTG-2026-06-12-full-project-dependency-check-prompt`.
