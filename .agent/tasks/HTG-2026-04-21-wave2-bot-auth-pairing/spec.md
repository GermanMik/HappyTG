# Task Spec

- Task ID: HTG-2026-04-21-wave2-bot-auth-pairing
- Title: Wave 2 bot auth pairing UX
- Owner: HappyTG
- Mode: proof
- Status: initialized

## Problem

Wave 1 normalized the HappyTG foundation contracts, but the Telegram bot still behaves like a command reference. Wave 2 must close the first product gap: a user should be able to open the bot, see a concise menu, pair a host, browse hosts/sessions/approvals, and start a task through guided callbacks without memorizing long commands.

The implementation must extend the existing TypeScript apps and packages. It must not create a second bot runtime, second API layer, second CLI, or Go rewrite. Telegram remains a control surface; the control plane remains the source of truth.

## Acceptance Criteria

1. Bot main menu is wizard-first and command-light
2. API exposes host/workspace/session/approval projections for bot flows
3. Approval callbacks use scoped decisions and nonce-aware replay basics
4. Existing daemon pairing and heartbeat flow remains compatible
5. Wave 2 proof evidence is recorded under .agent/tasks

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Preserve the existing `apps/bot/src/index.ts` runtime unless a narrow compatibility edit is unavoidable, because the worktree already contains unrelated user changes there.
- Use existing API service/store/protocol contracts and extend them backward-compatibly.
- Keep daemon pairing and heartbeat payloads compatible.
- Out of scope: rich Mini App screens, durable server-side wizard drafts, full JWT/session token hardening, and complete policy cascade implementation. Those belong to later waves.

## Verification Plan

- Unit: run affected API/Bot tests for projections, callback contracts, scoped approvals, menu rendering, wizard flow, and session cards.
- Integration: run full `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
- Bundle: run `pnpm happytg task validate --repo . --task HTG-2026-04-21-wave2-bot-auth-pairing --json`.
- Manual evidence: record the callback contract and user-facing bot message examples in `evidence.md`.
