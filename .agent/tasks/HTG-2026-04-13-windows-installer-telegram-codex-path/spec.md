# Task Spec

- Task ID: HTG-2026-04-13-windows-installer-telegram-codex-path
- Title: Windows installer Telegram/Codex path diagnostics
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The current Windows installer can end in a user-facing `Needs Attention` state even when the repository sync and core install steps completed, because two independent follow-up paths are conflated. First, the Telegram installer step treats any failed `getMe` lookup as a generic `Telegram bot lookup: ...` warning without distinguishing token/config errors from secondary lookup/network failures, and downstream UX can make that warning look like a broken Telegram configuration even when token, bot name, and allowed user ID were already captured. Second, the installer runs post-checks (`setup`, `doctor`, `verify`) in the just-prepared checkout, but those checks can still report `Codex CLI is not on the current shell PATH yet` on Windows and cascade into a recoverable failure summary, even in cases where Codex was installed through npm and the issue is PATH propagation or wrapper detection rather than a truly missing install. The fix must stay inside the existing bootstrap engine, preserve current Windows shim handling and installer-native interactive/structured paths, and make the resulting diagnostics accurately separate configuration state from follow-up environment issues.

## Acceptance Criteria

1. Installer distinguishes Telegram token/config failures from lookup/network/secondary secret failures.
2. Windows Codex PATH diagnostics distinguish real missing Codex from recoverable PATH/shim issues without false cascade failure.
3. Installer summary and post-check UX separate completed install from follow-up environment issues.

## Constraints

- Runtime: Codex CLI
- Builder/verifier separation is required by repo guidance; within this turn, keep code changes minimal and use a fresh post-change verification pass with no code edits during verification.
- Extend the existing bootstrap installer/doctor/runtime-adapter flow only; do not add a parallel standalone installer or bypass the bootstrap engine.
- Preserve Linux/macOS/Windows compatibility and keep existing `pnpm happytg setup`, `doctor`, `repair`, and `verify` entrypoints working.
- Do not weaken current Windows shim recovery logic in `packages/bootstrap/src/install/commands.ts` or runtime adapter executable resolution.
- Telegram diagnostics must distinguish missing/invalid token, network lookup failure, and secondary identity/secret-style lookup failure, and must not imply Telegram is wholly unconfigured when only a lookup step failed after valid config capture.
- Installer summary/final state should distinguish installer completion from optional or follow-up environment issues so warning-level Telegram issues and Codex PATH follow-up do not read like contradictory broken-config states.
- Architecture invariants remain unchanged: Telegram is not the internal transport for agent events; policy still precedes approval; heavy initialization remains lazy/cache-aware.

## Verification Plan

- Unit: extend bootstrap installer/runtime/CLI tests for Telegram lookup classification, preserved configured state on lookup failure, Windows Codex PATH diagnosis/reporting, and installer summary behavior for post-check follow-up issues.
- Integration: run targeted bootstrap/runtime-adapters tests first, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm happytg doctor`, and `pnpm happytg verify` as applicable; store outputs under this task bundle `raw/`.
- Manual: inspect final install summary strings and structured result payloads to ensure Telegram warnings stay warning-scoped and Codex PATH follow-up is reported as environment follow-up rather than as a contradictory broken install.
