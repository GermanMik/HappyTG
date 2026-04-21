# Task Spec

- Task ID: HTG-2026-04-21-wave4-miniapp-rich-ux
- Title: Wave 4 Mini App rich UX
- Owner: HappyTG
- Mode: proof
- Status: initialized

## Problem

Wave 3 gave HappyTG a reducer-backed operational core, but the Mini App is still mostly a diagnostic HTML listing. It does not validate Telegram Mini App launch data, does not issue backend app sessions, lacks screen-specific projections for action-first management, and does not preserve safe local draft state when the Telegram WebView is closed.

Wave 4 must turn the existing `apps/miniapp` TypeScript service into a mobile-first management surface while preserving the current repository shape. The API remains the source of truth; Mini App frontend state is recoverable draft/context only.

## Acceptance Criteria

1. Mini App launch validates Telegram initData and issues short-lived app sessions
2. API exposes action-first dashboard, sessions, approvals, hosts, reports, diff, verify, and bundle projections
3. Mini App renders mobile-first next-action screens with draft recovery and deep-link continuity
4. Dev CORS uses explicit allowlist without production wildcard
5. Mini App UX documentation includes required principles, IA, microcopy, and recovery examples

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Preserve the existing TypeScript-first monorepo and `apps/miniapp` server.
- Do not migrate the Mini App to a new framework in this wave.
- Do not trust Telegram client payloads or Mini App frontend state.
- Keep production CORS strict; dev origins must be explicit allowlist values.
- No public route or payload shape should make Telegram the source of truth.
- Out of scope: full WebSocket streaming, real raw git diff collection from hosts, and production PostgreSQL migrations beyond compatible store shape updates.

## Verification Plan

- Unit: targeted tests for Telegram initData validation, app session issuance, CORS allowlist behavior, and projection shaping.
- Integration: `pnpm --filter @happytg/api test` and `pnpm --filter @happytg/miniapp test`.
- Fresh verify: full `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then canonical task validation.
- Evidence: record commands in `raw/`, update `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, `state.json`, and `task.json`.
