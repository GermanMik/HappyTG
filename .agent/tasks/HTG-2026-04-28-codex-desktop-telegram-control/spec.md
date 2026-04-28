# HTG-2026-04-28-codex-desktop-telegram-control Spec

## Frozen Scope

Implement source-aware Codex control surfaces for HappyTG:

- Codex Desktop read-only projects and sessions from the local daemon/API adapter.
- Explicit `Codex Desktop` / `Codex CLI` choice in Telegram bot and Mini App.
- Guarded Desktop Resume/Stop/New Task endpoints and UI states based on a proven control contract.
- No direct `%USERPROFILE%\.codex` reads from Telegram bot or Mini App.
- No prompt/log/auth/config credential leakage.

## Contract Discovery Result

Local discovery recorded in `raw/` shows:

- `codex --version`: `codex-cli 0.125.0`.
- `codex resume [SESSION_ID] [PROMPT]` exists, but it starts/resumes a Codex CLI interactive session. This is not a proven Codex Desktop daemon-owned control handle for Telegram/Mini App.
- `codex app-server` exists but is explicitly experimental and exposes server/proxy tooling, not a stable documented HappyTG-safe Desktop session control contract.
- `codex exec-server` exists but is explicitly experimental and does not prove Desktop session Resume/Stop/New Task ownership.
- `%USERPROFILE%\.codex` contains `.codex-global-state.json`, `session_index.jsonl`, dated `sessions/**/*.jsonl`, and `archived_sessions`.

## Stable Read Contract

The local daemon/API adapter may read:

- `%USERPROFILE%\.codex\.codex-global-state.json`
- `%USERPROFILE%\.codex\session_index.jsonl`
- `%USERPROFILE%\.codex\sessions\**\*.jsonl`
- `%USERPROFILE%\.codex\archived_sessions\**`

The adapter must return sanitized projections only:

- `CodexDesktopProject`: `id`, `label`, `path`, `source: "codex-desktop"`, `lastSeenAt?`, `active?`
- `CodexDesktopSession`: `id`, `title`, `projectPath?`, `projectId?`, `updatedAt`, `status`, `source: "codex-desktop"`, `canResume`, `canStop`, `canCreateTask?`, `unsupportedReason?`

The adapter must tolerate missing/corrupt files and schema drift. It must not read `auth.json`, raw private payload content, prompt bodies, log bodies, tokens, or `config.toml` credentials.

## Project Contract

Projects are derived from sanitized workspace roots in `.codex-global-state.json`:

- `electron-saved-workspace-roots`
- `active-workspace-roots`
- `project-order`
- `thread-workspace-root-hints` values

Project identity is a stable local hash of the normalized path. Active state is true only when the path is listed in `active-workspace-roots`.

## Session Contract

Sessions are derived from:

- `session_index.jsonl` entries: `id`, `thread_name`, `updated_at`
- safe metadata from session JSONL files: top-level timestamps and payload metadata keys such as `id`, `cwd`, `timestamp`
- archived JSONL file location under `archived_sessions`

Raw `payload.content`, prompt text, log output, images, encrypted content, auth/config values, and tool payloads are never projected.

State classification:

- `archived`: session metadata came from `archived_sessions`
- `active`: only when a future stable Desktop state field explicitly identifies an active session
- `recent`: indexed or dated session without archived marker
- `unknown`: partial/corrupt metadata

## Control Contract Gates

Production contract status for this task:

- Resume: unsupported. `codex resume` is available but not proven as a Desktop/API-safe control handle.
- Stop: unsupported. No stable session -> process/control handle was discovered. Killing similar processes is forbidden.
- New Desktop Task: unsupported. No stable Desktop task creation contract was discovered.

Guard behavior:

- API returns `501` or `409` with a clear reason for unsupported controls.
- Telegram omits working Resume/Stop/New Desktop Task buttons when unsupported and shows a short reason.
- Mini App disables unsupported controls and shows a short reason.
- Future supported fixtures may enable these actions only through the adapter contract, after policy evaluation and audit recording.

## Source-Aware UX/API

All new projections use explicit `source`/`runtime`:

- `codex-cli`: existing HappyTG host/workspace/session flow
- `codex-desktop`: local Codex Desktop projections via API adapter

CLI and Desktop sessions must not be merged unless each item carries an explicit source label.

Telegram:

- `cx:m`: Codex menu
- `cx:c`: Codex CLI
- `cx:d`: Codex Desktop
- `cx:ns:c`: new task through CLI
- `cx:ns:d`: new task through Desktop
- `cd:p`: Desktop projects
- `cd:s`: Desktop sessions
- `cd:u:<sessionId>`: Desktop session card
- `cd:r:<sessionId>`: Desktop Resume
- `cd:x:<sessionId>`: Desktop Stop
- `cc:s`: CLI sessions

Mini App:

- Source switcher: `All`, `Codex Desktop`, `Codex CLI`
- Filters by source, project/repo, state, and sanitized search over title/project/path
- Desktop cards show actions and unsupported reasons
- Mutating actions call API endpoints only

## Acceptance

This task can pass with read-only Desktop visibility plus explicit source-aware Telegram/Mini App control shell, while Desktop Resume/Stop/New Task remain honestly unsupported until a stable contract is proven.
