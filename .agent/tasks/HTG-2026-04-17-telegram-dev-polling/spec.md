# Task Spec

- Task ID: HTG-2026-04-17-telegram-dev-polling
- Title: Telegram dev polling intake
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

The local HappyTG bot runtime does not process inbound Telegram messages unless an external webhook is configured and delivering updates to /telegram/webhook. In the current repo, docs and blueprint explicitly allow polling in development, but apps/bot exposes only a webhook HTTP endpoint and never calls getUpdates or registers a webhook. As a result, a developer can run `pnpm dev` and send /start or /pair to the bot, yet nothing reaches handlers.

## Acceptance Criteria

1. Local bot runtime receives Telegram messages without an externally configured webhook.
2. Webhook mode remains available for deployed setups without double-processing updates.
3. Regression coverage proves incoming Telegram updates are polled and dispatched to existing handlers.

## Constraints

- Runtime: Node.js/TypeScript bot service under `apps/bot`.
- Preserve webhook mode for deployed/public setups and avoid double-processing updates when webhook delivery is intended.
- Reuse existing message/callback handlers instead of reworking command semantics.
- Keep startup behavior diagnosable through logs and tests.

## Verification Plan

- Unit: extend apps/bot tests around polling mode selection and update dispatch.
- Integration: run `pnpm --filter @happytg/bot test`.
- Manual: simulate update intake locally or inspect startup behavior/logging for polling mode assumptions.
- Baseline: run targeted typecheck/build/lint commands as needed for touched scope.

