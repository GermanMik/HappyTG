# Task Spec

- Task ID: HTG-2026-04-17-release-0312-install-finalization-automation
- Title: Release 0.3.12 install finalization automation
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

HappyTG install completion currently leaks a flat, partially duplicated `nextSteps: string[]` model across install final summary, TUI, and JSON output. That causes four concrete defects:

1. Steps that are already safe to perform locally are left as manual follow-up instead of being executed inside the install flow.
2. Real environment constraints, reuse guidance, and mutually exclusive choices are mixed into the same flat list as actions.
3. Overlapping infra guidance repeats or conflicts across `setup`, `doctor`, `verify`, install final summary, and TUI/plain-text surfaces.
4. Pair/background guidance is not tied to the actual post-install state, so the final output can claim that a launcher was configured when it only fell back to manual, or can suggest a manual pair request even when the product already requested a code.

The fix must replace the accidental string-list behavior with a structured automation model, auto-run only the safe local steps, keep real manual Telegram/environment handoff visible, and carry the task through full release `0.3.12` proof and publish flow.

## Acceptance Criteria

1. Install finalization uses a structured automation model that distinguishes at least:
   - `auto`
   - `manual`
   - `warning`
   - `reuse`
   - `conflict`
   - `blocked`
2. Final install output is built from that model, not from ad-hoc string concatenation.
3. Safe local steps that the product can execute during install are executed automatically and shown as completed/applied rather than still pending.
4. Manual-only handoff stays explicit and truthful:
   - Telegram `/pair` remains manual when user interaction is required.
   - Missing/invalid Telegram configuration blocks pairing instead of still suggesting `pnpm daemon:pair`.
5. Reuse guidance, conflicts, and anti-footgun constraints are deduplicated to a truth-preserving minimum:
   - shared infra reuse
   - running HappyTG stack reuse
   - Redis reuse/remap guidance
   - compose-vs-`pnpm dev` conflict
   - mini app alternate-port guidance only when relevant
6. Already executed steps do not remain in pending `nextSteps`.
7. TUI, plain-text CLI output, JSON output, and post-check summaries stay consistent about:
   - what was auto-run
   - what still requires user action
   - what is reuse guidance
   - what is a warning/conflict/blocked constraint
8. Regression coverage exists for:
   - dedupe of overlapping next steps
   - reuse vs conflict classification
   - suppression of already-executed steps
   - manual pair step visibility
   - background requested-vs-actual classification
   - no contradictory “reuse current stack” plus “start another copy” output
9. Proof bundle is complete, a fresh verifier pass succeeds, and publish flow completes through branch, commit, push, PR, merge, and GitHub release/tag.

## Constraints

- Follow the repo proof loop manually because `$repo-task-proof-loop` is not available in this workspace.
- Read-only exploration may be parallelized; all edits, mutations, git actions, and publish actions must remain strictly sequential.
- Builder and verifier must be separate roles; verifier does not edit production code.
- Do not hide real environment constraints for a cleaner summary.
- Keep the fix scoped to install finalization automation, related output surfaces, regression coverage, and release `0.3.12` publish artifacts.

## Out Of Scope

- Large unrelated installer refactors.
- Simulating Telegram user actions or auto-claiming `/pair` on behalf of the user.
- Hiding real Codex/Telegram/infra/port failures when they remain environment-dependent.
- Reworking unrelated bootstrap diagnostics outside the finalization-model boundary.
- Non-release product changes unrelated to install finalization automation.

## Verification Plan

- Baseline reproduction:
  - `pnpm happytg install --json`
  - `pnpm happytg setup --json`
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
- Package-level regression:
  - `pnpm --filter @happytg/bootstrap typecheck`
  - `pnpm --filter @happytg/bootstrap test`
- Repo-level verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- Proof bundle validation:
  - `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-0312-install-finalization-automation`
- Fresh verification:
  - separate verifier role reviews diff, evidence, acceptance criteria mapping, and bundle completeness before publish.
