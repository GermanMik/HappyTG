# HTG-2026-05-03 Codex Vision/Control Repair Spec

Status: frozen before production-code changes.
Frozen at: 2026-05-03.
Branch: codex/happytg-codex-vision-control-repair.

## Goal

Verify and minimally repair HappyTG visibility and control for Codex CLI and Codex Desktop.

"Vision" means source-aware visibility of projects, sessions/tasks, details, statuses, and history/transcripts where the source has a proven read contract.

"Control" means safe Resume, Stop/Cancel, and New Task/Start actions only where a stable local contract is proven. Unsupported actions must return honest unsupported responses with reason codes and disabled UI, never fake success.

## Non-Negotiable Constraints

- Do not assume Codex Desktop control is supported.
- Do not implement Desktop Stop through process kill, window close, lock-file deletion, or direct mutation of Desktop-owned state.
- Do not return success for unsupported actions.
- Keep explicit source/runtime discrimination for `codex-cli` and `codex-desktop` in API, Telegram callbacks, Mini App flows, and tests.
- Telegram remains a render/control surface, not internal agent event transport.
- Mutating host operations must be serialized and audited.
- Policy evaluation must happen before approval evaluation or dispatch.
- Higher-level policy deny cannot be weakened by lower-level overrides.
- Heavy runtime initialization must be lazy and cache-aware.
- Production code changes must be minimal and limited to confirmed gaps.

## Source/Surface/Capability Matrix

| Source | Surface | Capability | Expected | Evidence required |
| --- | --- | --- | --- | --- |
| `codex-cli` | Backend API | list sessions/tasks | supported | HappyTG session APIs return CLI sessions with `runtime: codex-cli`; tests cover list/detail. |
| `codex-cli` | Backend API | view details/status/history | supported/degraded | Session detail/timeline APIs expose status, task, approval, event history; no raw transcript guarantee unless stored events exist. |
| `codex-cli` | Backend API | resume | supported | Proven `codex resume --help` local contract for CLI; HappyTG resume state transition/dispatch path tested. |
| `codex-cli` | Backend API | stop/cancel | supported as control-plane cancel | Cancel marks HappyTG session/dispatch cancelled; no host process kill. |
| `codex-cli` | Backend API | start/new task | supported | `codex exec --help` local contract and HappyTG paired-host dispatch path tested. |
| `codex-cli` | Telegram Bot | list sessions/tasks | supported | `/codex`, `Codex CLI`, `/sessions` callbacks are source-aware and tested. |
| `codex-cli` | Telegram Bot | view details/status/history | supported/degraded | Session card exposes status, task phase, verify state, summary/error; Mini App handles richer detail. |
| `codex-cli` | Telegram Bot | resume | supported | `/resume` and callback route to CLI session resume API. |
| `codex-cli` | Telegram Bot | stop/cancel | supported | Session cancel callback routes to control-plane cancel API. |
| `codex-cli` | Telegram Bot | start/new task | supported | Wizard stores `runtime: codex-cli`; tests cover runtime selection. |
| `codex-cli` | Mini App | list sessions/tasks | supported | Sessions/project/new-task pages show CLI source/runtime. |
| `codex-cli` | Mini App | view details/status/history | supported | Session, task, diff, verify, timeline endpoints render source-aware detail. |
| `codex-cli` | Mini App | resume | degraded | Existing Mini App detail exposes actions; backend resume API is available. If UI lacks a direct button, document residual risk. |
| `codex-cli` | Mini App | stop/cancel | degraded | Backend cancel exists; Mini App may not expose a direct cancel button unless already present. |
| `codex-cli` | Mini App | start/new task | supported | New task form posts `runtime: codex-cli`. |
| `codex-desktop` | Backend API | list projects | supported if read-only state files exist | Adapter reads sanitized `CODEX_HOME/.codex-global-state.json` only; tests prove no private payload leak. |
| `codex-desktop` | Backend API | list sessions/tasks | supported/degraded | Adapter reads sanitized `session_index.jsonl`, `sessions/**/*.jsonl`, and `archived_sessions/**/*.jsonl`; transcript/history is not exposed unless a safe read contract is proven. |
| `codex-desktop` | Backend API | view details/status/history | supported/degraded | Session projection exposes sanitized details/status; no raw Desktop transcript unless safe parser exists and tests prove sanitization. |
| `codex-desktop` | Backend API | resume | unsupported unless stable Desktop app-server/IPC/API mutating contract is proven | Evidence must include exact local command/API, request/response shape, failure modes, timeout, and audit path. Otherwise return 501/unsupported reason. |
| `codex-desktop` | Backend API | stop/cancel | unsupported unless stable Desktop app-server/IPC/API mutating contract is proven | Evidence must exclude process-kill/window/lock workarounds and include exact safe interrupt contract. Otherwise return 501/unsupported reason. |
| `codex-desktop` | Backend API | start/new task | unsupported unless stable Desktop app-server/IPC/API mutating contract is proven | Evidence must include exact start/turn invocation and stable failure behavior. Otherwise return 501/unsupported reason. |
| `codex-desktop` | Telegram Bot | list projects/sessions | supported | `/codex` Desktop buttons call Desktop projection APIs and label source. |
| `codex-desktop` | Telegram Bot | view details/status/history | supported/degraded | Desktop session card labels source/status and unsupported reasons. |
| `codex-desktop` | Telegram Bot | resume/stop | unsupported unless backend proves control | Buttons must be hidden/disabled when unsupported; callback failure must not look successful. |
| `codex-desktop` | Telegram Bot | start/new task | unsupported unless backend proves control | Wizard must report unsupported reason, not fake creation. |
| `codex-desktop` | Mini App | list projects/sessions | supported | Codex panel filters by `source=codex-desktop`; project/session cards carry source. |
| `codex-desktop` | Mini App | view details/status/history | supported/degraded | Detail page shows source, status, capabilities, reason codes. |
| `codex-desktop` | Mini App | resume/stop | unsupported unless backend proves control | Controls disabled or return non-success JSON with reason. |
| `codex-desktop` | Mini App | start/new task | unsupported unless backend proves control | Source option disabled with reason unless capability is proven. |

## Contract Discovery Scope

Codex CLI:

- Run and save `codex --help`, `codex resume --help`, `codex exec --help`, and any repo-referenced Codex subcommand help relevant to local execution.
- Record exact supported invocations, timeout expectations, and error modes.

Codex Desktop:

- Read only safe local state files and safe help output.
- Check `codex app-server --help` and related read-only documentation/help if available.
- Do not perform mutating Desktop actions during discovery.
- A Desktop mutating contract is accepted only if it is documented or otherwise stable enough to cite exact JSON-RPC/API method names, parameters, failure behavior, and version/feature gate. Experimental/private app-server behavior alone is insufficient for default production enablement.

## Build Scope

Make only the minimal code/test changes needed after discovery:

- Correct capability flags and reason codes.
- Ensure source/runtime discriminators are explicit.
- Ensure unsupported Desktop actions are not advertised as success.
- Ensure mutating actions go through a serialized queue/audit path or are kept unsupported.
- Ensure policy is evaluated before approval or mutation.
- Add/update focused tests for supported and unsupported paths.

## Verification Scope

Capture outputs in `.agent/tasks/HTG-2026-05-03-codex-vision-control-repair/raw/`:

- `lint.txt`: `pnpm lint`
- `typecheck.txt`: `pnpm typecheck`
- `test-unit.txt`: `pnpm test`
- `test-integration.txt`: task-scoped integration/smoke tests where applicable
- `doctor.txt`: `pnpm happytg doctor`
- `verify.txt`: `pnpm happytg verify`

Completion requires `evidence.md`, `evidence.json`, `verdict.json`, and `problems.md`.
