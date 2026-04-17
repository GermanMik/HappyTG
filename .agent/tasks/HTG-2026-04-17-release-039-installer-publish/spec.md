# HTG-2026-04-17-release-039-installer-publish

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-17
- Coordinator: Codex main agent
- Builder role: Codex main agent
- Verifier role: `task-verifier`
- Fixer role: `task-fixer` if verifier finds scoped issues

## Goal

Bring the HappyTG installer/setup/doctor/verify flow to a truthful release-ready state for 0.3.9 by fixing product bugs where they exist, improving diagnostics where the machine environment is the root cause, deduplicating final summary and next-step output, and completing the publish flow only after a successful fresh verify.

## In Scope

### 1. Telegram `getMe` timeout diagnostics

- Find the code that builds the Telegram `getMe` URL, performs the fetch, and produces warning text.
- Reproduce the reported `Connection to api.telegram.org timed out.` path without exposing secrets in artifacts.
- Distinguish, where safely possible, among:
  - missing token;
  - invalid token;
  - malformed endpoint or URL construction;
  - DNS resolution failure;
  - IPv4 versus IPv6 reachability differences;
  - connect timeout;
  - TLS or certificate failure;
  - proxy, WinHTTP, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, firewall, or AV interception issues;
  - Node `fetch` or `undici` behavior differences;
  - Bot API specific reachability issues;
  - poor internal diagnostic classification.
- If the root cause is environmental, keep the warning but make it more precise and actionable.
- Ensure diagnostics can truthfully explain that Telegram Desktop working on the same host does not prove Bot API HTTPS reachability.

### 2. Codex websocket 403 classification and dedupe

- Find the smoke-check/readiness code and the summary generation that surfaces `Codex could not open the Responses websocket (403 Forbidden)`.
- Determine whether this is a blocking failure, a legitimate warning under otherwise usable CLI behavior, or a product diagnostic bug.
- Remove warning storms and cross-surface duplication across setup, doctor, verify, Final Summary, and Next steps without hiding true environment issues.
- Keep severity and wording aligned with the actual usability of the CLI.

### 3. Final Summary and Next steps dedupe

- Find the code that builds Final Summary warnings and Next steps.
- Remove duplicate `pnpm dev`, duplicate pairing guidance, repeated warning surfaces, and overlapping infra advice.
- Keep output concise, non-contradictory, and severity-correct.

### 4. Mini App port 3001 warning classification

- Verify whether port 3001 is a real conflict or a supported reuse case.
- Keep truthful conflict or reuse guidance.
- Prevent this case from inflating or duplicating final summary and next-step output.

### 5. Proof bundle and regression coverage

- Produce the full proof bundle in this task directory.
- Add regression tests for fixed product bugs and output dedupe behavior.
- If a path cannot be fully covered with tests, document why in evidence and verdict.

### 6. Finish and publish

- After a successful fresh verifier pass, perform commit, push, PR, merge, and release/tag flow for 0.3.9 if metadata is ready or prepared in this scope.
- Include publish artifacts in the final report.

## Out of Scope

- Unrelated refactors outside installer/bootstrap/runtime-adapter diagnostics.
- Hiding legitimate environment warnings just to force a green result.
- Changing non-diagnostic runtime behavior except where minimally required to support truthful classification.
- Storing secrets, tokens, cookies, or session data in git, logs, or proof artifacts.
- Broad release metadata churn beyond what is needed for 0.3.9 publication.

## Constraints

- Read-only exploration may be parallelized.
- Mutating edits and other write actions must stay strictly serialized.
- Verifier must be a separate role and must not edit production code.
- Any post-verifier production change must be a minimal scoped fix only.
- Publish steps happen only after successful fresh verify.

## Acceptance Criteria

1. Telegram diagnostics no longer collapse to a bare timeout message when safer, more precise classification is available.
2. Telegram diagnostics can truthfully distinguish general connectivity from Bot API HTTPS path failures where the probes allow it.
3. Codex websocket 403 warnings are classified correctly and do not storm across setup, doctor, verify, Final Summary, and Next steps.
4. Final Summary and Next steps are deduplicated, concise, truthful, and severity-correct.
5. Mini App port 3001 remains truthfully classified as conflict or supported reuse without misleading escalation.
6. Regression coverage is added for fixed product bugs and dedupe logic.
7. Proof bundle contains baseline reproduction, changes, evidence, verifier output, and final verdict.
8. Commit, push, PR, merge, and release/tag are completed only after successful fresh verify.

## Evidence Plan

- Baseline reproduction:
  - `pnpm happytg setup --json`
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- Safe Telegram reachability probes with redaction where needed:
  - DNS resolution;
  - TCP/HTTPS reachability;
  - PowerShell and Node-side probes;
  - IPv4 versus IPv6 evidence where feasible.
- Targeted regression tests for Telegram/Codex/summary/port diagnostics.
- Fresh independent verifier pass and recorded verdict.
