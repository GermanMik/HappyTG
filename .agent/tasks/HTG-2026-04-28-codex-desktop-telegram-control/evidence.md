# Evidence

## Contract Discovery

- `raw/codex-version.txt`: local Codex is `codex-cli 0.125.0`.
- `raw/codex-help.txt`, `raw/codex-resume-help.txt`: `codex resume` exists, but only as a CLI interactive resume command, not a proven Codex Desktop daemon/API control handle.
- `raw/codex-app-server-help.txt`, `raw/codex-exec-server-help.txt`: commands exist but are experimental and do not prove stable Desktop Resume/Stop/New Task ownership.
- `raw/codex-home-overview.txt`: local `.codex` has `.codex-global-state.json`, `session_index.jsonl`, dated `sessions/**/*.jsonl`, and `archived_sessions`; no secrets or raw payloads were copied into evidence.

## Implementation

- Added `CodexDesktopStateAdapter` in `packages/runtime-adapters/src/codex-desktop.ts`.
- Added protocol models with explicit `source/runtime`: `codex-cli` and `codex-desktop`.
- Added API endpoints:
  - `GET /api/v1/codex-desktop/projects`
  - `GET /api/v1/codex-desktop/sessions`
  - `POST /api/v1/codex-desktop/sessions/:id/resume`
  - `POST /api/v1/codex-desktop/sessions/:id/stop`
  - `POST /api/v1/codex-desktop/tasks`
- Desktop mutating endpoints evaluate policy and record audit attempts/results before returning supported or unsupported outcomes.
- Added Telegram Codex menu with explicit `Codex Desktop` / `Codex CLI` choice and source-aware new-task wizard.
- Telegram Desktop session callbacks use short stable refs for long Desktop ids and resolve the real id through the API session list.
- Added Mini App Codex panel with source filters, Desktop projects/sessions, state/search filters, detail/action panel, and disabled unsupported controls.

## Guarded Contract Result

Production Desktop controls remain unsupported:

- Resume: unsupported because no stable Desktop/API-safe control handle was proven.
- Stop: unsupported because no stable session-to-process/control handle was proven; no process-kill workaround was implemented.
- New Desktop Task: unsupported because no stable Desktop task creation contract was proven.

Supported-control tests use an injectable adapter fixture only; production defaults stay disabled.

## Verification

- `raw/lint.txt`: `pnpm lint` passed.
- `raw/typecheck.txt`: `pnpm typecheck` passed.
- `raw/test-unit.txt`: `pnpm test` passed.
- `raw/smoke-telegram.txt`: targeted Telegram Codex/task-wizard smoke passed.
- `raw/smoke-miniapp.txt`: targeted Mini App Codex/Desktop smoke passed.
- `raw/fresh-verifier.txt`: fresh read-only verifier pass recorded; verifier made no production edits.
- `raw/doctor.txt`: `pnpm happytg doctor` completed but reported FAIL due local environment: missing `.env`/`TELEGRAM_BOT_TOKEN` and Mini App port conflict.
- `raw/verify.txt`: `pnpm happytg verify` completed but reported FAIL for the same environment blockers.
- Release PR: https://github.com/GermanMik/HappyTG/pull/40
- GitHub check `verify`: PASS on PR #40 after the pushed release commits.
- GitHub PR #40 remains draft and reports `mergeStateStatus=DIRTY`.

## Security / Privacy Evidence

- Telegram and Mini App call API endpoints; they do not read `.codex` directly.
- Adapter projections omit raw prompt/log/message payloads and do not read `auth.json`.
- Stop is not implemented by killing similar processes.
- Adapter control flags require both a supported contract flag and a real handler; it does not return successful no-op Resume/Stop/New Task results.
- Fresh verifier grep findings were reviewed and documented as false positives or pre-existing CLI behavior, not Desktop control behavior.

## Release Closeout

- Commit pushed to `origin/codex/codex-desktop-telegram-control-20260428`.
- Draft PR opened as #40 because local release verification is blocked.
- Merge was not attempted because `verdict.json` is BLOCKED until required local `doctor/verify` can pass and PR mergeability is resolved.
