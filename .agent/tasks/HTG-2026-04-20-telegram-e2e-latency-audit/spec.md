# Task Spec

- Task ID: HTG-2026-04-20-telegram-e2e-latency-audit
- Title: Telegram end-to-end latency audit and bounded transport repair
- Owner: Codex
- Mode: proof-loop
- Status: frozen

## Problem

HappyTG still shows slow or inconsistent Telegram replies even after prior fixes for local-dev polling, Windows polling/webhook Bot API fallback, and poison-update replay. Current evidence already suggests local services are not the main bottleneck: `api /health` is about `104 ms`, `bot /health` about `44 ms`, and `bot /ready` about `267 ms`, while direct Node HTTPS Bot API access fails around `10.7 s` with `UND_ERR_CONNECT_TIMEOUT` and PowerShell succeeds around `0.4 s`.

This task must prove, with fresh repo-local evidence, whether the remaining user-facing latency is caused by inbound delivery, handler logic, local API latency, outbound `sendMessage`, or a combination, and then apply only the minimum bounded fix needed to restore acceptable reply latency without weakening delivery-mode, auth, pairing, approval, or truthful readiness/logging semantics.

The current uncommitted poison-update change in `apps/bot/src/index.ts` and `apps/bot/src/index.test.ts` is treated as existing workspace state and must not be reverted.

## Acceptance Criteria

1. A canonical proof bundle exists at `.agent/tasks/HTG-2026-04-20-telegram-e2e-latency-audit/` with `spec.md`, `evidence.md`, `evidence.json`, `verdict.json`, `problems.md`, `task.json`, and `raw/` artifacts.
2. Fresh evidence answers all explicit latency questions from the user prompt:
   - whether slowness is inbound delivery, handler logic, local API latency, outbound `sendMessage`, or mixed;
   - measured time split across Node attempt, fallback transition, and PowerShell Bot API call;
   - whether `sendMessage` currently waits for the full Node transport timeout before fallback;
   - whether a bounded fix can materially improve reply latency without hiding failures;
   - measured before/after Telegram reply latency if a fix is made.
3. Any product change is bounded to the real bottleneck and preserves explicit `auto|polling|webhook` semantics, truthful logs and `/ready` output, and existing pairing/approval/user-binding boundaries.
4. Regression coverage is added for the exact latency or transport failure mode repaired.
5. Fresh verification is recorded after the fix, and the final proof does not rely on builder claims alone.

## Constraints

- Runtime: keep the explicit `auto|polling|webhook` model unchanged; do not silently change explicit webhook mode into polling.
- Policy implications: do not weaken `/api/v1/pairing/claim`, approval resolution, or user-binding boundaries.
- Security boundaries: do not bypass Telegram API truthfulness, auth checks, or approval semantics.
- Scope: do not redesign the Telegram subsystem; prefer a minimal `apps/bot` transport/runtime repair if outbound latency is the real bottleneck.
- Workspace discipline: preserve the existing uncommitted poison-update fix as baseline workspace state.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bot run test`
- Integration:
  - `pnpm --filter @happytg/bot run typecheck`
  - `pnpm --filter @happytg/bot run build`
  - `pnpm --filter @happytg/bot run lint`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-20-telegram-e2e-latency-audit`
- Manual:
  - measure local `/health` and `/ready` timings
  - measure direct Node and PowerShell Telegram Bot API timings
  - prove current webhook/polling handling path and whether reply latency is dominated by outbound `sendMessage`
  - capture before/after end-to-end reply latency around the bounded fix
- Evidence files to produce:
  - `raw/init-analysis.txt`
  - `raw/live-health.txt`
  - `raw/live-ready.txt`
  - `raw/node-getme-timing.txt`
  - `raw/powershell-getme-timing.txt`
  - `raw/sendmessage-node-timing.txt`
  - `raw/sendmessage-fallback-timing.txt`
  - `raw/webhook-smoke.txt`
  - `raw/polling-smoke.txt`
  - `raw/before-latency.txt`
  - `raw/after-latency.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/typecheck.txt`
  - `raw/build.txt`
  - `raw/lint.txt`
  - `raw/task-validate.txt`
