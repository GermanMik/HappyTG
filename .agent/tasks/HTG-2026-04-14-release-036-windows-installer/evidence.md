# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Windows interactive Telegram token paste accepts terminal paste chunks with trailing newline or CRLF and preserves installer-native validation/masking. | `packages/bootstrap/src/install/tui.ts`; `packages/bootstrap/src/install.test.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/test-unit.txt` |
| Windows interactive allowed user ID paste accepts at least one pasted numeric ID and preserves typed input/navigation behavior. | `packages/bootstrap/src/install/telegram.ts`; `packages/bootstrap/src/install/tui.ts`; `packages/bootstrap/src/install.test.ts`; `packages/bootstrap/src/install.runtime.test.ts`; `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/test-unit.txt` |
| Installer/bootstrap guidance explicitly names supported non-Docker infra alternatives such as system Redis or external `REDIS_URL` and no longer implies Docker is the only path when alternatives are already supported. | `packages/bootstrap/src/index.ts`; `packages/bootstrap/src/index.test.ts`; `docs/installation.md`; `docs/quickstart.md`; `docs/bootstrap-doctor.md`; `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/test-unit.txt` |
| Release metadata is updated to `0.3.6` with changelog and release notes, and release validation passes. | `package.json`; workspace `package.json` files; `CHANGELOG.md`; `docs/releases/0.3.6.md`; `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/release-check.txt` |

## Root Cause

1. `packages/bootstrap/src/install/tui.ts` read Telegram form input through raw `keypress` events, but the reducer assumed pasted text and confirm keys would arrive as separate events.
2. On the real Windows terminal path, a paste can arrive as a single multi-character chunk that already contains trailing `\r` / `\n`. The old reducer either waited for a second confirm key that never came or risked handling `return` before the pasted text was committed.
3. The low-level path stripped bracketed-paste markers and CR/LF only as generic text cleanup. It did not distinguish chunk parsing from field-specific normalization, so bot-token and allowed-user-id fields were not committed reliably from pasted terminal input.
4. Dockerless guidance was already partially supported in bootstrap through Redis detection and `REDIS_URL`, but the user-facing wording still leaned too hard on Compose and did not clearly name supported existing-service alternatives such as `DATABASE_URL`, `REDIS_URL`, and `S3_ENDPOINT`.

## Verification

- Passed:
  - `pnpm --filter @happytg/bootstrap test`
  - `pnpm --filter @happytg/bootstrap typecheck`
  - `pnpm release:check --version 0.3.6`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-14-release-036-windows-installer`
- Not rerun for this minimal diff:
  - full workspace `pnpm build`
  - full workspace `pnpm lint`
  - full workspace `pnpm test`

## Artifacts

- `packages/bootstrap/src/install/tui.ts`
- `packages/bootstrap/src/install/telegram.ts`
- `packages/bootstrap/src/install.test.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/index.test.ts`
- `docs/installation.md`
- `docs/quickstart.md`
- `docs/bootstrap-doctor.md`
- `CHANGELOG.md`
- `docs/releases/0.3.6.md`
- `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/test-unit.txt`
- `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/typecheck.txt`
- `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/release-check.txt`
- `.agent/tasks/HTG-2026-04-14-release-036-windows-installer/raw/task-validate.txt`
