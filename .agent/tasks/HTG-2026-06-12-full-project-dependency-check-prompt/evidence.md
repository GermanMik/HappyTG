# Evidence Summary

## Acceptance Criteria Mapping

1. Added `docs/prompts/happytg-full-project-dependency-proof-loop-check.md`.
2. The prompt includes dependency-aware scope for workspace, source, runtime, infra, external services, and security dependencies.
3. The prompt requires `.agent/tasks/<TASK_ID>/` artifacts, frozen spec, raw outputs, fresh verifier review, and synchronized proof metadata.
4. The prompt defines the iteration rule after every fix and requires targeted validation plus final full matrix.
5. The prompt preserves HappyTG architecture invariants, LM Studio preference, and no-Ollama fallback policy.
6. Validation outputs are recorded in `raw/lint.txt` and `raw/task-validate.txt`.

## Artifacts

- docs/prompts/happytg-full-project-dependency-proof-loop-check.md
- .agent/tasks/HTG-2026-06-12-full-project-dependency-check-prompt/raw/lint.txt
- .agent/tasks/HTG-2026-06-12-full-project-dependency-check-prompt/raw/task-validate.txt
