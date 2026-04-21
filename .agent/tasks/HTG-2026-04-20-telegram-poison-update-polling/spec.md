# Task Spec

- Task ID: HTG-2026-04-20-telegram-poison-update-polling
- Title: Prevent stale Telegram update failures from blocking polling delivery
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

The current local bot process on `main` is not blocked by Telegram transport anymore: polling is active and the Windows PowerShell Bot API fallback still validates the configured bot token on this host. However, the live `/ready` endpoint shows Telegram delivery as degraded because a previously received `/pair` command now fails against `/api/v1/pairing/claim` with `Pairing code expired`.

The current polling loop treats that handler exception as a loop-level failure, does not advance the Telegram update offset for the failing update, and then replays the same stale update indefinitely. That creates a poison-update condition where one bad command prevents later `/start` or other messages from being processed.

## Acceptance Criteria

1. Repo-local evidence proves that the current silent-Telegram symptom comes from a replayed failing update, not from delivery-mode selection or Telegram token validity.
2. The bot polling runtime no longer lets one failing update block subsequent updates.
3. Telegram transport readiness remains about Telegram delivery state, not user-command handler failures.
4. Regression coverage proves that a failing update does not get replayed forever and that later updates still run.
5. Verification artifacts for the bounded bot-scope fix are captured in this task bundle.

## Constraints

- Keep the explicit `auto|polling|webhook` delivery model unchanged.
- Do not weaken pairing, approval, or API authorization boundaries.
- Do not broaden scope into API status-code redesign or unrelated transport changes.
- Keep the fix minimal and localized to the bot runtime/handler path.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bot run test`
- Integration:
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
- Manual:
  - inspect live `/ready` and current bot process state
  - prove token validity via PowerShell Bot API on this host
  - prove the poison-update replay condition from current runtime/code
- Evidence files to produce:
  - `raw/init-analysis.txt`
  - `raw/test-unit.txt`
  - `raw/typecheck.txt`
  - `raw/build.txt`
  - `raw/live-ready-before.txt`
  - `raw/live-ready-after.txt`
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
