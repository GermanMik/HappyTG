# HTG-2026-06-11 Mini App Speed Prompt Release Spec

Status: frozen before prompt and release metadata edits.
Branch: `codex/miniapp-speed-prompt`

## Goal

Release a repo-local reusable prompt that guides a future HappyTG Telegram Mini App speed optimization pass with measurable timings, proof evidence, Graphify discipline, and 10 independent critical perspectives.

## Scope

- Add or refine `docs/prompts/happytg-miniapp-speed-optimization.md`.
- Ensure the prompt requires critical review from 10 independent roles before implementation choices.
- Keep the prompt bounded to Mini App speed: initial load, route navigation, API projections, Codex Desktop data, payload size, timeout/failure states, and action feedback.
- Add proof evidence for this docs/release task.
- Prepare release metadata for `0.4.19` because `0.4.18` is already on `origin/main` and tagged.

## Non-Goals

- Do not implement the future Mini App speed optimization in this task.
- Do not change runtime, policy, approval, Telegram auth, session, Docker, or infrastructure behavior.
- Do not run heavy semantic Graphify extraction or add cloud/Ollama dependencies.
- Do not expose secrets, tokens, private endpoints, or machine-local credentials in evidence.

## Expected Artifacts

- `docs/prompts/happytg-miniapp-speed-optimization.md`
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/evidence.md`
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/evidence.json`
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/problems.md`
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/verdict.json`
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/raw/*`
- Version/release metadata for `0.4.19`.

## Verification

Run and capture:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm release:check --version 0.4.19`
- `pnpm happytg task validate --repo . --task HTG-2026-06-11-miniapp-speed-prompt-release`
- `git diff --check`
- Graphify query/update evidence that is narrow and does not run heavy semantic extraction.

`pnpm happytg doctor` and `pnpm happytg verify` are desirable for a release, but if local environment blockers or time constraints appear, record the exact reason in `problems.md` instead of claiming a pass.

## Acceptance Criteria

- Prompt is actionable for a future speed pass and requires timings before performance claims.
- Prompt includes 10 independent role perspectives with blockers, risks, required evidence, and go/no-go criteria.
- Prompt preserves HappyTG architecture invariants and local LM Studio policy.
- Release metadata validates for `0.4.19`.
- Proof bundle records branch state, 10-role critique, raw validation outputs, Graphify evidence, and fresh verifier verdict.
- Branch is pushed, PR/merge/release are completed when GitHub access permits, and obsolete task branches are cleaned up when safe.
