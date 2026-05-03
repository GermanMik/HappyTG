# HTG-2026-05-03-doctor-warning-cleanup Spec

## Scope

- Investigate and fix noisy `pnpm happytg doctor` / `pnpm happytg verify` warnings reported after `v0.4.12`.
- Target symptoms:
  - Codex Responses websocket 403 followed by successful HTTP fallback is shown as WARN.
  - Already-running local HappyTG services are presented in a way that looks like a remaining warning.
- Preserve truthful failure reporting when Codex smoke does not return the expected success signal.
- Preserve setup/doctor/verify safety, token secrecy, public Mini App auth behavior, and runtime/source discrimination.

## Non-Goals

- Do not change Telegram, Mini App, policy, approval, or host mutation semantics.
- Do not suppress real service conflicts or failed readiness checks.
- Do not require stopping the user's currently running local services.
- No release unless explicitly requested after the fix.

## Acceptance Criteria

- `doctor/verify` classify a successful Codex HTTP fallback as non-warning informational output.
- Running HappyTG services are reported as reuse info, not as a warning-level condition or contradictory start instruction.
- Real Codex smoke failures remain WARN/FAIL with actionable detail.
- Focused bootstrap tests cover the changed behavior.
- Standard verification output is captured in this proof bundle.

## Frozen

Spec frozen before production-code edits on 2026-05-03.
