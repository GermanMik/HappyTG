# Evidence

Task: `HTG-2026-06-11-miniapp-speed-prompt-release`

## Spec Freeze

- `spec.md` was frozen before refining the prompt and release metadata.
- Work is isolated on `codex/miniapp-speed-prompt`.
- EchoVault context and targeted search were run before edits.
- Existing Graphify navigation evidence was queried before finalizing the prompt shape; no heavy semantic extraction was run.

## 10-Role Critical Review

| Role | Verdict | Critical findings | Resolution |
| --- | --- | --- | --- |
| Release Manager | GO after metadata | `0.4.18` is already `origin/main` and tagged; shipping this branch requires a new patch release. | Added `0.4.19` workspace versions, changelog entry, and release notes. |
| QA/Test Engineer | GO after validation | A docs prompt still needs proof-loop evidence and release validation; otherwise it is not release-ready. | Added task bundle and planned lint/typecheck/test/build/release/task validation raw outputs. |
| Security/Secrets Reviewer | GO | Prompt/evidence must not capture tokens, `.env`, private endpoints, or raw credentials. | Artifact is docs-only and includes explicit no-secrets/no-unbounded-logs constraints. |
| Architecture Invariants Reviewer | GO | Speed guidance could accidentally encourage bypassing auth, policy, source discrimination, or serialized mutations. | Prompt repeats non-negotiable invariants and rejects fake success or weakened contracts. |
| Mini App Performance Reviewer | GO | Original artifact needed independent WebView/API/payload latency perspectives, not just a timing checklist. | Added 10 independent performance roles and measured baseline requirements. |
| Codex Desktop Adapter Reviewer | GO | Mini App speed work often stalls on optional Desktop control; future work must keep CLI/file-backed projections distinct. | Prompt requires Desktop adapter timings, bounded optional projections, fallback truth, and source discrimination. |
| Cache/Data Correctness Reviewer | GO | Caching can make stale state look authoritative. | Prompt requires explicit freshness limits, invalidation, stale/partial labels, and mutation-boundary discipline. |
| Graphify/Knowledge Reviewer | GO with freshness note | Existing graph is useful for prompt/release navigation but built from an older commit. | Captured focused `graphify query`; will attempt narrow `graphify update docs/prompts` after docs changes. |
| Git/Branch Hygiene Reviewer | GO after push/merge/cleanup | Branch is local-only and dirty until commit; final state must not leave obsolete branches. | Plan covers commit, push, PR, merge, release, and safe local/remote cleanup. |
| Operator Impact Reviewer | GO | A reusable speed prompt helps future Mini App performance work, but does not itself speed up runtime. | Release notes state this is a prompt/proof artifact only, with future implementation explicitly deferred. |

## Synthesis

| Finding | Supporting roles | Severity | Decision | Evidence |
| --- | --- | --- | --- | --- |
| Branch is useful but unreleased. | Release Manager, Git/Branch Hygiene, Operator Impact | Required | Ship as `0.4.19` docs-only prompt release. | `CHANGELOG.md`, `docs/releases/0.4.19.md`, package versions |
| Prompt needed independent critical perspectives. | Mini App Performance, QA, Architecture, Security, Cache | Required | Added 10-role section with blockers, risks, evidence, and go/no-go. | `docs/prompts/happytg-miniapp-speed-optimization.md` |
| Future speed work must be measured and bounded. | Mini App Performance, API Latency, Desktop Adapter, QA | Required | Prompt requires baseline/after timings, payload sizes, slow-upstream tests, and bounded failure states. | Prompt measurement and verification sections |
| Runtime safety must not be traded for speed. | Architecture, Security, Cache, Desktop Adapter | Blocker if violated | Kept this task docs-only and encoded invariants in prompt. | Prompt non-negotiable invariants |
| Graphify should support navigation without heavy extraction. | Graphify/Knowledge, QA | Required | Used focused query and recorded raw output; heavy semantic extraction deferred. | `raw/graphify-query.txt` |

## Changed Files

- `docs/prompts/happytg-miniapp-speed-optimization.md`
  - Added 10 independent performance roles and required synthesis.
  - Added 10-role findings to fresh verifier requirements.
- `package.json`, `apps/*/package.json`, `packages/*/package.json`
  - Version bumped from `0.4.18` to `0.4.19`.
- `CHANGELOG.md`
  - Added `v0.4.19` entry.
- `docs/releases/0.4.19.md`
  - Added release notes.
- `.agent/tasks/HTG-2026-06-11-miniapp-speed-prompt-release/`
  - Added proof bundle.

## Verification Plan

## Verification

| Command | Raw output | Status |
| --- | --- | --- |
| `git status --short --branch` | `raw/branch-status-before-validation.txt` | PASS |
| `git diff --stat` | `raw/diff-stat-before-validation.txt` | PASS |
| `graphify query "HappyTG Mini App prompt release 10 role docs prompts" --budget 1200` | `raw/graphify-query.txt` | PASS |
| `graphify update docs/prompts` | `raw/graphify-update-docs-prompts.txt` | PASS with cleanup |
| `pnpm lint` | `raw/lint.txt` | PASS |
| `pnpm typecheck` | `raw/typecheck.txt` | PASS |
| `pnpm test` | `raw/test.txt` | FAIL, transient bootstrap suggested-port assertion |
| `pnpm --filter @happytg/bootstrap test` | `raw/test-bootstrap-rerun.txt` | PASS |
| `pnpm test` rerun | `raw/test-rerun.txt` | PASS |
| `pnpm build` | `raw/build.txt` | PASS |
| `pnpm release:check --version 0.4.19` | `raw/release-check.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| `pnpm happytg doctor` | `raw/doctor.txt` | WARN, exit 0 |
| `pnpm happytg verify` | `raw/verify.txt` | WARN, exit 0 |
| `pnpm happytg task validate --repo . --task HTG-2026-06-11-miniapp-speed-prompt-release` | `raw/task-validate.txt` | PASS with missing canonical metadata warning |
| `pnpm happytg task validate --repo . --task HTG-2026-06-11-miniapp-speed-prompt-release` rerun | `raw/task-validate-rerun.txt` | PASS |

## Fresh Verifier

- Verdict: PASS for local release candidate.
- Blocking findings: none.
- Residuals:
  - Initial full `pnpm test` failed once in `@happytg/bootstrap` on a suggested-port count assertion; targeted package rerun and full suite rerun both passed.
  - `doctor` and `verify` exited 0 with a Codex memory startup stderr warning.
  - `graphify update docs/prompts` generated a nested `docs/prompts/graphify-out/` artifact; it was removed as generated noise, while raw Graphify evidence was retained.

## Publication State

- Commit, push, PR, merge, release workflow, and branch cleanup are pending after task validation.
