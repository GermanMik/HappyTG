# HTG-2026-04-17-release-0310-warning-triage

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-17
- Coordinator: Codex main agent
- Builder role: `task-builder`
- Verifier role: `task-verifier`
- Fixer role (only if verifier finds scoped issues): `task-fixer`

## Goal

Produce HappyTG release `0.3.10` by truthfully classifying and, where needed, minimally fixing installer/setup/doctor/verify diagnostics for Telegram Bot API probing, Codex websocket smoke warnings, Final Summary / Next steps duplication, and Mini App port `3001`, with repo-local evidence, fresh independent verification, and full publish flow after verification passes.

## In Scope

### 1. Telegram diagnostics

- Find the code path that builds the Telegram `getMe` URL, executes the probe/fetch, and emits warnings.
- Reproduce the current warning path safely, with token redaction in artifacts.
- Distinguish where safely possible:
  - missing token;
  - invalid token;
  - malformed endpoint / URL;
  - DNS resolution issue;
  - IPv4 vs IPv6 reachability issue;
  - connect timeout;
  - TLS / certificate issue;
  - proxy / WinHTTP / `NO_PROXY` / firewall / AV interception issue;
  - Node `fetch` / undici / curl specific behavior;
  - Bot API specific reachability issue;
  - internal misclassification.
- Keep legitimate external warnings visible, but make wording precise, truthful, and actionable.
- Explain correctly that Telegram Desktop working on the same host does not prove Bot API HTTPS reachability.
- Add regression coverage for any product bug or misclassification fixed in code.

### 2. Codex websocket `403 Forbidden` warnings

- Find the smoke-check / readiness / summary generation path for Codex diagnostics.
- Determine whether websocket `403 Forbidden` is blocking, warning-only with usable fallback, or misclassified.
- Fix severity/wording/dedupe if the current output is misleading or noisy.
- Ensure `setup`, `doctor`, `verify`, Final Summary, and post-check results do not generate a repeated warning storm.
- Keep any real warning visible if the fallback path is usable but degraded.
- Add regression coverage for the product root cause(s) fixed.

### 3. Final Summary / Next steps / end-screen duplication

- Find the code that builds Final Summary, Next steps, and any final TUI/end-screen rendering.
- Determine whether the duplicate Final Summary observation is a real product bug or a render/logging artifact.
- Fix any real duplication, overlapping advice, or repeated warning surfacing across step-level output, Final Summary, and post-check reporting.
- Keep the final output concise, truthful, and non-contradictory.
- Add regression coverage where a stable automated assertion is practical; if not practical, document why in evidence/verdict.

### 4. Mini App port `3001` warning

- Determine whether the `3001` case is a real conflict or a supported reuse case.
- Do not suppress a legitimate conflict warning.
- Ensure summary and next-step output mention this case once, with concrete, non-duplicated advice.

### 5. Regression coverage

- Add or update regression tests for the fixed product bugs and dedupe/classification paths.
- If any scoped path cannot be adequately locked by tests, document the reason in `evidence.md` and `verdict.json`.

### 6. Proof bundle and publish flow

- Maintain the canonical proof bundle in this task directory, including raw artifacts from reproduction, verification, and publish checks.
- After successful fresh verification, perform the full publish flow:
  - version/release metadata updates required for `0.3.10`;
  - commit;
  - push;
  - PR creation with the required body sections;
  - merge to the target branch;
  - GitHub tag/release creation.

## Out of Scope

- Unrelated refactors outside the scoped diagnostics / release work.
- Hiding real environment warnings just to produce green output.
- Logging or committing secrets, tokens, cookies, session data, or API keys.
- Changes to runtime behavior beyond the minimum needed for truthful diagnostics, dedupe, or release metadata.
- External machine remediation beyond diagnostic guidance.

## Constraints

- Read-only exploration may be parallelized.
- Production edits, file writes, git operations, release operations, and other mutations must be serialized.
- Builder and verifier must be separate roles.
- Verifier must not edit production code.
- Any post-verifier code change must be the minimum scoped fix.
- Truthful environment warnings must remain visible if they are real.

## Acceptance Criteria

1. Telegram diagnostics are no longer misleading and distinguish invalid token, transport-specific failures, Desktop-vs-Bot-API reachability caveats, and broader connectivity issues where safe evidence allows.
2. Codex websocket `403 Forbidden` is severity-correct, wording-correct, and non-duplicated across `setup`, `doctor`, `verify`, and Final Summary.
3. Final Summary, Next steps, and end-screen output do not duplicate the same warnings or overlapping advice and remain concise and non-contradictory.
4. Mini App port `3001` remains truthfully classified as a real conflict or supported reuse case, without exaggerated severity or duplicated advice.
5. Regression coverage exists for fixed product bugs and stable dedupe/classification paths, with any uncovered path explicitly justified.
6. Proof bundle contains frozen scope, reproduction artifacts, evidence, verifier output, and final verdict.
7. Release `0.3.10` is fully published only after a successful fresh verifier pass.

## Verification Plan

- Baseline reproduction:
  - `pnpm happytg setup --json`
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
  - `pnpm happytg install --json`
- Workspace verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- Targeted diagnostics probes:
  - Telegram DNS / TCP / HTTPS / PowerShell / Node-side probe collection with redaction
  - proxy / WinHTTP / environment inspection without exposing secrets
  - targeted regression tests for bootstrap/shared/runtime-adapter packages as needed
- Fresh verifier pass:
  - independent `task-verifier` agent reruns scoped checks and validates the proof bundle
- Evidence files to produce:
  - `evidence.md`
  - `evidence.json`
  - `verdict.json`
  - `problems.md`
  - `raw/build.txt`
  - `raw/lint.txt`
  - `raw/typecheck.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/setup-json.txt`
  - `raw/doctor-json.txt`
  - `raw/verify-json.txt`
  - `raw/install-json.txt`
  - `raw/telegram-probe.txt`
  - `raw/codex-smoke.txt`
  - `raw/release-check.txt`
  - `raw/task-validate.txt`
