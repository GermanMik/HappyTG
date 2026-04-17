# Evidence Summary

## Acceptance Criteria Mapping

1. Bootstrap `getMe` no longer warns on Windows when PowerShell can validate the same token after a Node HTTPS timeout.
   - Code: `packages/bootstrap/src/install/telegram.ts`
   - Regression: `packages/bootstrap/src/install.test.ts`, `packages/bootstrap/src/install.runtime.test.ts`
   - Test proof: `raw/test-unit.txt` now contains both the low-level helper success case (`fetchTelegramBotIdentity accepts Windows PowerShell validation as a success fallback after a Node timeout`) and the install-path success case (`runHappyTGInstall treats a transport-probe-validated Telegram identity as a normal success path`).
   - Current host state: `raw/host-direct-node-getme.txt` still shows the original Node HTTPS timeout, while `raw/host-powershell-getme-worktree-current.txt`, `raw/host-bootstrap-getme-worktree-current.txt`, and `raw/install-json-worktree-current.txt` show that the updated token stored in the isolated worktree `.env` validates `@Gerta_homebot` and lets the install path pass the Telegram step via the PowerShell-assisted fallback.
   - Negative control: `raw/host-powershell-getme-current.txt`, `raw/host-bootstrap-getme-current.txt`, and `raw/install-json.txt` preserve the earlier source `.env` `401 Unauthorized` case, proving invalid credentials stay truthful instead of being flattened into a transport warning.

2. Bot `sendMessage` no longer drops outbound replies on Windows when Node HTTPS fails but PowerShell Bot API requests succeed.
   - Code: `apps/bot/src/index.ts`
   - Regression: `apps/bot/src/index.test.ts`
   - Test proof: `raw/test-unit.txt` includes the new bot cases that verify Windows PowerShell fallback after a Node transport timeout and that real Telegram HTTP failures stay truthful without invoking the fallback.

3. Regression coverage proves the Windows fallback path without masking invalid-token or Bot API HTTP failures.
   - Scoped proof: `raw/test-unit.txt`
   - Live success proof: `raw/host-powershell-getme-worktree-current.txt`, `raw/host-bootstrap-getme-worktree-current.txt`, `raw/install-json-worktree-current.txt`
   - Live invalid-token proof: `raw/host-powershell-getme-current.txt`, `raw/host-bootstrap-getme-current.txt`, `raw/install-json.txt`
   - Repo proof: `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test-integration.txt`
   - Bundle proof: `raw/task-validate.txt`

## Artifacts

- `apps/bot/src/index.ts`
- `apps/bot/src/index.test.ts`
- `packages/bootstrap/src/install/telegram.ts`
- `packages/bootstrap/src/install.test.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `raw/build.txt`
- `raw/install-json.txt`
- `raw/lint.txt`
- `raw/typecheck.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/host-direct-node-getme.txt`
- `raw/host-powershell-getme-current.txt`
- `raw/host-powershell-getme-worktree-current.txt`
- `raw/host-bootstrap-getme-current.txt`
- `raw/host-bootstrap-getme-worktree-current.txt`
- `raw/task-validate.txt`
- `raw/install-json-worktree-current.txt`
