# HTG-2026-05-03 Codex Vision/Control Repair Evidence

## Init Evidence

- EchoVault context/search/details were retrieved before repository work.
- Worktree started clean on `main`; branch `codex/happytg-codex-vision-control-repair` was created.
- Package scripts available from `package.json`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm happytg doctor`, `pnpm happytg verify`.

## Primary Code Map

- Runtime adapters: `packages/runtime-adapters/src/index.ts`, `packages/runtime-adapters/src/codex-desktop.ts`.
- Protocol/source models: `packages/protocol/src/index.ts`.
- Backend API/control plane: `apps/api/src/service.ts`, `apps/api/src/index.ts`.
- Telegram Bot callbacks/wizard: `apps/bot/src/handlers.ts`.
- Mini App source-aware browsing/control: `apps/miniapp/src/index.ts`.
- Policy and execution classification: `packages/policy-engine/src/index.ts`, `packages/runtime-adapters/src/index.ts`.
- CLI host execution and proof loop: `apps/host-daemon/src/index.ts`.
- Focused tests found in `packages/runtime-adapters/src/index.test.ts`, `apps/api/src/service.test.ts`, `apps/api/src/index.test.ts`, `apps/bot/src/handlers.test.ts`, `apps/miniapp/src/index.test.ts`, `packages/policy-engine/src/index.test.ts`.

## Initial Findings Before Contract Discovery

- `CodexRuntimeSource = "codex-cli" | "codex-desktop"` already exists in protocol.
- HappyTG sessions and pending dispatches currently support only `runtime: "codex-cli"`.
- Codex Desktop projections are implemented through sanitized reads from `CODEX_HOME` files such as `.codex-global-state.json`, `session_index.jsonl`, `sessions/**/*.jsonl`, and `archived_sessions/**/*.jsonl`.
- Desktop session projection already carries `source: "codex-desktop"`, `canResume`, `canStop`, `canCreateTask`, and `unsupportedReason`.
- API exposes Desktop endpoints: `/api/v1/codex-desktop/projects`, `/sessions`, `/sessions/:id/resume`, `/sessions/:id/stop`, and `/tasks`.
- Telegram `/codex` menu separates Codex Desktop and Codex CLI and has Desktop project/session callbacks.
- Mini App has Codex source filters, Desktop cards, Desktop action POST route, and source-aware new task form.
- `packages/runtime-adapters/src/codex-desktop.ts` currently includes an app-server JSON-RPC control contract. Default behavior enables app-server control for the normal default adapter unless `HAPPYTG_CODEX_DESKTOP_CONTROL=off|unsupported|false` or a test-only `codexHome` option is used. This is the primary safety item to verify or repair.
- Desktop Stop implementation in current code uses `turn/interrupt` through app-server, not process kill/window/lock mutation.
- Generic `runCodexExec` timeout cleanup uses child termination for CLI subprocesses. This is not Desktop Stop and is outside the forbidden Desktop workaround.
- Policy engine tests already cover higher-level deny before lower-layer allow/approval.

## External Discipline Sources

- `repo-task-proof-loop` was referenced as proof-loop discipline: freeze spec first, collect repo-local evidence, then verify fresh.
- Mintlify quickstart/verify command references were used as process discipline, not as repository evidence.

## Contract Discovery

### Codex CLI

- Local version was captured in `raw/codex-version.txt`: `codex-cli 0.125.0`.
- `codex --help` was captured in `raw/codex-help.txt`.
- PowerShell redirection made direct `codex resume --help` and `codex exec --help` fail with `stdin is not a terminal`; those failures are saved in `raw/codex-resume-help.txt`, `raw/codex-exec-help.txt`, and related retry files.
- `cmd.exe /d /c` captured successful command help:
  - `raw/codex-cmd-exec-help.txt`: `codex exec [OPTIONS] [PROMPT]` with `--json`, `--output-last-message`, `--cd`, sandbox/profile/model flags, and non-interactive execution.
  - `raw/codex-cmd-resume-help.txt`: `codex resume [OPTIONS] [SESSION_ID] [PROMPT]`, interactive resume command with `--last`, `--all`, and `--include-non-interactive`.
  - `raw/codex-cmd-app-server-help.txt`: `codex app-server [experimental]`.
  - `raw/codex-cmd-app-server-generate-ts-help.txt`: `codex app-server generate-ts` also marked experimental and gated by `--experimental`.
  - `raw/codex-cmd-exec-server-help.txt`: `exec-server` marked `[EXPERIMENTAL]`.
- HappyTG CLI New Task/Start uses the existing host-daemon dispatch path to `codex exec`; that path is already serialized in `apps/host-daemon/src/index.ts` by sequential `processDispatch` calls in `runOnce`.
- HappyTG CLI Resume/Cancel are backend control-plane state transitions/dispatch cancellation, not Codex Desktop control and not Telegram-as-internal-transport.

### Codex Desktop Read Contract

- Existing Desktop visibility is read-only and sanitized from local Codex state:
  - `CODEX_HOME/.codex-global-state.json`
  - `CODEX_HOME/session_index.jsonl`
  - `CODEX_HOME/sessions/**/*.jsonl`
  - `CODEX_HOME/archived_sessions/**/*.jsonl`
- Tests prove projection excludes raw prompt/private payload strings and carries `source: "codex-desktop"`.
- Desktop transcript/deep history remains degraded in this scope: projection reads bounded metadata, not full raw transcripts, to avoid exposing raw local payloads.

### Codex Desktop Mutating Contract

- Local Codex exposes app-server JSON-RPC shapes, and generated TypeScript bindings were captured under `raw/app-server-ts/`.
- Generated protocol includes methods such as `thread/list`, `thread/resume`, `thread/turns/list`, `turn/interrupt`, `thread/start`, and `turn/start`.
- This does not prove a stable production contract:
  - `codex app-server` is explicitly marked `[experimental]`.
  - `codex app-server generate-ts` is experimental and requires `--experimental`.
  - Generated `InitializeCapabilities` includes `experimentalApi`.
  - Generated v2 params mark history/path fields as unstable/internal in places.
- Decision: Codex Desktop Resume/Stop/New Task stay unsupported by default with reason code `CODEX_DESKTOP_CONTROL_UNSUPPORTED`. The app-server JSON-RPC contract remains only as an explicitly injected/tested contract, not automatic production default.
- No Desktop Stop process-kill/window/lock-file workaround is implemented.

## Build Evidence

- `packages/runtime-adapters/src/codex-desktop.ts`: default Desktop control contract no longer auto-enables experimental app-server; sessions carry `unsupportedReasonCode`; injected app-server contract still returns unavailable reason code if explicitly used.
- `packages/protocol/src/index.ts`: `CodexDesktopSession` and `MiniAppSessionCard` now include `unsupportedReasonCode`.
- `apps/api/src/service.ts` and `apps/api/src/index.ts`: Desktop control errors include `reasonCode`; unsupported actions audit attempts and unsupported records; supported injected mutations run through a strict service-level serial queue.
- `packages/runtime-adapters/src/index.ts`: `codex_desktop_resume`, `codex_desktop_stop`, and `codex_desktop_new_task` are classified as `shell_network_system_sensitive` with `serial_mutation` execution lane.
- `apps/bot/src/handlers.ts`: Telegram Desktop cards and New Desktop Task wizard show reason codes for unsupported Desktop actions.
- `apps/miniapp/src/index.ts`: Mini App Desktop cards/actions/new-task form carry and render reason codes; unsupported controls stay disabled.
- Targeted checks passed:
  - `pnpm --filter @happytg/runtime-adapters test`
  - `pnpm --filter @happytg/api test`
  - `pnpm --filter @happytg/bot test`
  - `pnpm --filter @happytg/miniapp test`

## Verification Evidence

- `raw/lint.txt`: `pnpm lint` exit 0, 15/15 turbo tasks successful.
- `raw/typecheck.txt`: `pnpm typecheck` exit 0, 15/15 turbo tasks successful.
- `raw/test-unit.txt`: `pnpm test` exit 0, 15/15 turbo tasks successful.
- `raw/test-integration.txt`: `pnpm --filter @happytg/api test` exit 0, 25/25 API tests passed; used as task-local integration smoke because there is no separate root integration script.
- `raw/doctor.txt`: `pnpm happytg doctor` exit 0 with WARN. Warning: Codex Responses websocket returned 403 and CLI fell back to HTTP. Info: HappyTG services already running on local ports.
- `raw/verify.txt`: `pnpm happytg verify` exit 0 with the same WARN/INFO profile.
- `raw/release-check.txt`: `pnpm release:check --version 0.4.10` exit 0; checked 16 package versions, `CHANGELOG.md`, and `docs/releases/0.4.10.md`.
- `raw/build.txt`: `pnpm build` exit 0; 15/15 turbo tasks successful.
- `raw/task-validate.txt`: `pnpm happytg task validate --repo . --task HTG-2026-05-03-codex-vision-control-repair` exit 0; proof bundle validation ok.
- `raw/fresh-verifier-1.txt`: first fresh verifier pass found no production-code blocker, but failed proof completion because `evidence.json`, `problems.md`, and `verdict.json` were still marked in-progress.
- `raw/fresh-verifier-2.txt`: second fresh verifier pass found no implementation blocker and confirmed the first metadata fix, but failed terminal status because `verdict.json` still had `pass=false` and `problems.md` still had the second verifier item open.
- `raw/fresh-verifier-3.txt`: final sanity verifier passed; no edit-requiring blockers remain.
