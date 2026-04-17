# HTG-2026-04-17-telegram-windows-transport-fallback

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-17
- Coordinator: Codex main agent
- Builder role: Codex main agent
- Verifier role: fresh local verifier pass
- Fixer role: Codex main agent, minimum scoped diff only if verification finds a task-local issue

## Goal

Remove the Windows-only HappyTG Telegram transport failure where Node HTTPS/undici times out against `api.telegram.org` on this host while a PowerShell Bot API request with the same token can still reach Telegram. The product should recover in the minimum safe scope instead of leaving bootstrap `getMe` in warning state or silently dropping outbound bot replies.

## Baseline

- Direct repo-local Node probe on 2026-04-17 reproduced `fetch failed` with `causeCode=UND_ERR_CONNECT_TIMEOUT` and `Connect Timeout Error (attempted address: api.telegram.org:443, timeout: 10000ms)`.
- `doctor --json` still shows the workspace is otherwise usable and does not currently report a token-format problem.
- Environment checks show no proxy env vars in the current shell and WinHTTP reports direct access, so the task should not assume the token is bad or require user-side proxy setup as the primary fix.
- The working tree already contains unrelated user changes in `packages/bootstrap/src/install/types.ts` and `packages/bootstrap/src/finalization.ts`; this task must not revert or trample them.

## In Scope

1. Bootstrap Telegram identity fallback

- Keep existing Telegram error classification logic for missing token, invalid token, API errors, and unexpected responses.
- Change the Windows network-timeout path so a successful PowerShell `getMe` fallback is treated as a real validation success rather than a warning-only diagnostic.

2. Bot outbound message fallback

- Change the bot runtime `sendMessage` path so a Windows Node HTTPS transport failure retries through PowerShell Bot API instead of dropping the reply.
- Preserve current logging for real Telegram HTTP/API failures.

3. Regression coverage

- Add or update automated tests that prove the bootstrap fallback success path.
- Add or update automated tests that prove the bot `sendMessage` fallback path.
- Keep invalid-token and API-failure behavior truthful.

## Out of Scope

- Non-Windows Telegram transport changes.
- Broad HTTP client refactors outside the minimum needed Telegram paths.
- Changes to unrelated bootstrap finalization work already present in the working tree.
- User-machine remediation steps such as proxy/firewall edits.

## Constraints

- Production edits remain serialized and minimal.
- Do not overwrite or revert unrelated existing user changes.
- Keep secrets out of task artifacts.
- Verification must include targeted regressions and a fresh repo-level pass appropriate to the scoped change.

## Acceptance Criteria

1. Bootstrap `getMe` no longer warns on Windows when PowerShell can validate the same token after a Node HTTPS timeout.
2. Bot `sendMessage` no longer drops outbound replies on Windows when Node HTTPS fails but PowerShell Bot API requests succeed.
3. Regression coverage proves the Windows fallback path without masking invalid-token or Bot API HTTP failures.

## Evidence Plan

- Baseline host reproduction for the direct Node `getMe` timeout.
- Targeted unit tests for bootstrap Telegram identity fallback and bot send-message fallback.
- Fresh verification with `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- Task bundle artifacts recorded under this directory, including raw command output and final verdict files.
