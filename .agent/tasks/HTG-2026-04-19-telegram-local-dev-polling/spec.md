# Task Spec

- Task ID: HTG-2026-04-19-telegram-local-dev-polling
- Title: Honest local Telegram delivery mode without public webhook
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

Local `pnpm dev` / `pnpm dev:bot` starts `apps/bot` and logs `Bot listening`, but the current runtime only exposes `POST /telegram/webhook` and does not consume Telegram `getUpdates`. In local development without a public webhook URL, `/start` and `/pair <CODE>` never reach bot handlers even though the bot process, health endpoints, pairing-code generation, and `getMe` can all look healthy.

This is a product bug and a docs/runtime mismatch:

- `apps/bot/src/index.ts` starts an HTTP server and routes only `/telegram/webhook`.
- Current bot runtime/tests contain no polling loop, `getUpdates`, `setWebhook`, or `deleteWebhook` path.
- `docs/self-hosting.md` and `docs/engineering-blueprint.md` already state that polling is allowed for local development.
- `docs/quickstart.md` and `docs/installation.md` currently imply that `Bot listening` plus a valid token is enough for local Telegram pairing UX, which is misleading in webhook-only reality.

## Acceptance Criteria

1. Repo-local evidence proves the current root cause, current startup path, absence of polling, and the docs/runtime mismatch before the fix.
2. `apps/bot` supports an explicit and deterministic Telegram delivery-mode strategy with bounded modes:
   - `polling`
   - `webhook`
   - `auto`
3. Local development without a public webhook can receive `/start`, `/pair <CODE>`, `/hosts`, `/doctor`, `/verify`, and `/session ...` through polling, using the same bot handlers and preserving the existing `/api/v1/pairing/claim` boundary.
4. Explicit webhook mode does not silently degrade into polling. If webhook mode is expected but not configured or not actually active, the state is diagnosable in logs and bot readiness output instead of looking healthy.
5. Production/self-hosted webhook handling remains available and the existing webhook endpoint path stays working.
6. Regression tests cover local polling `/start`, local polling `/pair CODE`, webhook handling, deterministic mode selection, and prevention of accidental mixed-mode duplicate delivery.
7. Minimal necessary docs and config references are synchronized with runtime behavior and local `pnpm dev` messaging is honest about active Telegram delivery mode.

## Constraints

- Runtime: `pnpm dev` and `pnpm dev:bot` must work locally without requiring a public domain for baseline Telegram bot interaction.
- Policy implications: delivery-mode selection must not weaken policy checks, approval checks, or daemon pairing rules.
- Security boundaries: do not bypass `/api/v1/pairing/claim`, user lookup, or approval resolution boundaries; do not silently mask Telegram API failures as success.
- Out of scope: redesigning Telegram auth, changing pairing ownership rules, or broad deployment automation outside minimal delivery-mode selection and diagnostics.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bot run test`
- Integration:
  - `pnpm --filter @happytg/bot run build`
  - `pnpm --filter @happytg/bot run typecheck`
- Manual:
  - prove pre-fix webhook-only behavior from current code and runtime shape
  - verify post-fix mode-selection logs and readiness payload behavior
- Evidence files to produce:
  - `raw/init-analysis.txt`
  - `raw/test-unit.txt`
  - `raw/build.txt`
  - `raw/typecheck.txt`
  - `raw/repo-test.txt`
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
