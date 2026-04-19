# Task Spec

- Task ID: HTG-2026-04-19-telegram-start-still-silent
- Title: Diagnose why `/start` is still silent on local main
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

After shipping and releasing the local Telegram polling fix in `0.3.18`, the user still observes that `/start` does not receive a response in local development. The previous fix proved code-path support for polling and passed tests, so this follow-up must determine whether the remaining failure is:

- a product bug in the current runtime path on `main`,
- a configuration/runtime mismatch in local execution,
- a misleading health/logging state,
- or an environment-specific issue outside the shipped bot code.

The task must prove the actual execution path before making any new production changes.

## Acceptance Criteria

1. Repo-local evidence shows how the current bot runtime on `main` chooses Telegram delivery mode and what conditions are required for polling to actually consume updates.
2. The investigation proves whether the user symptom is caused by code regression, local configuration, launch/orchestration gap, Telegram API state, or another deterministic root cause.
3. If a repo bug exists, the fix is minimal, bounded, and preserves the explicit delivery-mode model introduced in `0.3.18`.
4. If no repo bug exists, diagnostics, logs, docs, or readiness messaging are improved so the silent-failure state stops being misleading.
5. Regression coverage or proof artifacts are added for the newly identified root cause.

## Constraints

- Runtime: keep the explicit `auto|polling|webhook` model; do not silently change explicit webhook into polling.
- Policy implications: do not weaken Telegram auth, pairing, approval, or daemon boundaries.
- Security boundaries: do not bypass `/api/v1/pairing/claim`, user lookup, or Telegram API failure handling.
- Out of scope: broad Telegram redesign, deployment automation changes, or unrelated install/release work.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bot run test`
- Integration:
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
- Manual:
  - prove the current startup path and delivery-mode selection on `main`
  - reproduce or falsify the silent `/start` symptom with repo-local evidence
- Evidence files to produce:
  - `raw/init-analysis.txt`
  - `raw/test-unit.txt`
  - `raw/typecheck.txt`
  - `raw/build.txt`
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
