# HTG-2026-05-11-full-verify-release-0.4.14

## Scope

Prepare and release HappyTG 0.4.14 from an isolated `codex/...` branch.

Included changes:

- Keep the existing Docker pnpm activation retry fix from `codex/docker-pnpm-retry-happytg-name`.
- Keep the existing Graphify navigation artifacts, AGENTS Graphify guidance, and MinIO image pin already committed on the feature branch.
- Exclude `.env` and `.env.*` from Docker build context if verification confirms they are not already ignored.
- Add a reusable full-project verification and release prompt grounded in 10 independent role perspectives.
- Add release metadata for 0.4.14: workspace package versions, changelog entry, release notes, and proof evidence.

## Non-goals

- Do not redesign runtime architecture.
- Do not weaken policy, approval, serialized mutation, Telegram transport, or lazy runtime initialization invariants.
- Do not introduce Ollama configuration or cloud-only Graphify/LLM dependencies.
- Do not remove existing committed Graphify artifacts unless verification finds a blocking safety issue.

## Acceptance Criteria

- The prompt describes a full HappyTG verification/release workflow and explicitly covers branch handling, dirty-worktree safety, evidence, memory, and 10-role review.
- `pnpm release:check --version 0.4.14` passes.
- Repo validation commands are run and raw output is stored under `raw/`.
- A fresh verifier pass reviews spec, diff, role findings, validation outputs, and release metadata.
- If checks pass, branch is pushed, PR is opened, merged to `main`, GitHub Release `v0.4.14` is created, and obsolete local/remote release branches are deleted when safe.
- EchoVault memory is saved before final response.

## Evidence Plan

- Record 10 independent role findings in `evidence.md`.
- Store command output in `raw/`.
- Record structured command results in `evidence.json`.
- Record verifier verdict in `verdict.json`.
- Track blockers and residual risks in `problems.md`.
