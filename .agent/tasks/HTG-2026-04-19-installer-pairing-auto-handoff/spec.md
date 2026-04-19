# Task Spec

- Task ID: HTG-2026-04-19-installer-pairing-auto-handoff
- Title: Make installer pairing handoff automatically refresh safe cases
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

`pnpm happytg install` already auto-requests a pairing code when no local daemon host state exists, but it falls back to manual `pnpm daemon:pair` whenever `daemon-state.json` contains any `hostId`. That local-only heuristic collapses already paired hosts and merely registered hosts into the same reuse path, so existing-but-unpaired hosts miss the safe auto-request path and users get contradictory/manual pairing guidance.

## Root Cause Hypothesis

1. `packages/bootstrap/src/install/index.ts` reads only `{ hostId }` from local daemon state, even though the daemon state file also carries enough context to probe the control plane.
2. `buildInstallFinalizationItems()` treats any local `hostId` as a reuse/handoff condition and never asks the backend whether that host is actually `registering` or already `paired` / `active`.
3. The real pairing claim boundary still lives in Telegram `/pair` via `apps/bot/src/handlers.ts`, so installer-side automation can only safely automate code issuance and handoff, not the user claim itself.

## Architecture Decision

- Do not implement fake zero-touch pairing.
- Keep Telegram `/pair <CODE>` as the only pairing claim boundary.
- Implement maximum safe automation instead:
  - probe backend host status for an existing local host;
  - reuse without new code when backend says `paired` or `active`;
  - auto-request a fresh pairing code when backend says the host is still `registering` or otherwise needs refresh;
  - keep blocked/manual diagnostics when Telegram token validation or API reachability prevents safe progress.

## Pairing State Machine

1. `blocked-telegram`
   Trigger: Telegram lookup is `failed` or `not-attempted`.
   Result: pairing remains blocked; no code request or daemon-start handoff.
2. `auto-request-new-host`
   Trigger: onboarding still needs pairing and no local daemon `hostId` exists.
   Result: request code automatically; show `/pair CODE` handoff.
3. `probe-existing-host`
   Trigger: onboarding still needs pairing and local daemon state includes `hostId`.
   Result: probe backend host state before deciding reuse vs refresh.
4. `reuse-existing-host`
   Trigger: backend reports `paired` or `active`.
   Result: show honest reuse guidance only; do not request a new pairing code.
5. `refresh-existing-host`
   Trigger: backend reports `registering`, `stale`, `revoked`, or the host no longer exists.
   Result: request/refresh a pairing code automatically; show explicit `/pair CODE` handoff.
6. `manual-fallback`
   Trigger: backend probe or auto-request cannot complete safely after prerequisites looked ready.
   Result: show honest actionable fallback without contradicting any successful auto-request.

## Acceptance Criteria

1. Installer does not ask the user to run `pnpm daemon:pair` manually when prerequisites are ready and a pairing code can be requested safely during install.
2. An already paired/active existing host stays on a reuse path and does not emit a fresh pairing code.
3. An existing local `hostId` whose backend record is unpaired/registering refreshes the pairing code automatically during install and renders an explicit `/pair CODE` handoff.
4. Missing/invalid Telegram token and API-unavailable paths stay honest, blocked, and actionable.
5. Telegram `/pair` remains the actual claim boundary; auth/security semantics are not weakened.
6. Deterministic regression coverage exists for:
   - no-state auto-request;
   - existing local hostId plus unpaired/registering host refresh;
   - existing paired host reuse/no code;
   - blocked token/API path;
   - no contradictory manual `pnpm daemon:pair` after successful auto-request.

## Constraints

- Keep installer/startup orchestration separate from pairing decision logic.
- Use existing final summary/TUI/finalization surfaces; no ad-hoc UI pipeline.
- Preserve resumable install draft behavior.
- Keep writes minimal and directly related to pairing/install finalization.
- Read-only exploration only before build; serialized writes after spec freeze.

## Verification Plan

- `pnpm --filter @happytg/bootstrap run build`
- `pnpm --filter @happytg/bootstrap run typecheck`
- `pnpm --filter @happytg/bootstrap run test`
- Targeted bootstrap installer tests around pairing finalization/runtime flows
- API package tests if a host-status probe contract changes
