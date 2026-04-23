# Changelog

## Unreleased

## v0.4.3

### Fixed

- Local Mini App launch diagnostics now prefer the local Mini App URL/port over the local API URL, so `pnpm happytg doctor` and runtime guidance stop pointing operators at the wrong local launch surface.
- Telegram Mini App launch/menu setup now routes through the public HTTPS `/miniapp` URL and keeps a Windows PowerShell fallback when Node fetch cannot reach `api.telegram.org`.
- Windows polling fallback moves from the timed-out Node transport to PowerShell `getUpdates` faster, reducing delayed startup when the primary transport stalls.
- Docker Compose startup guidance now uses `--env-file .env`, so installer-saved `HAPPYTG_*_PORT` overrides reach published host ports consistently.

### Added

- `pnpm happytg install` now exposes explicit launch modes for local development, Docker Compose startup, manual command output, and skip.
- Installer Docker startup validates Compose configuration, starts the packaged control-plane stack, reports Compose/HTTP health, and keeps host-daemon pairing/startup outside containers.

### Changed

- Release metadata is aligned at `0.4.3` across the workspace for the installer Docker launch mode and Telegram launch/polling repair release.

### Verification

- Release validation covers release metadata, installer Docker launch guidance, Telegram Mini App menu launch, Windows polling fallback, repo checks, and canonical task validation for the included proof bundles.

## v0.4.2

### Fixed

- Mini App HTML routes now respond as `text/html`, so Telegram/browser WebViews render the UI instead of displaying raw HTML source.
- Docker Compose keeps the Mini App container listener on internal port `3001` while still allowing a host port such as `3007`, preventing Caddy from drifting when local port conflicts are resolved.
- Interactive install port conflict resolution now keeps `HAPPYTG_APP_URL` and `HAPPYTG_DEV_CORS_ORIGINS` in sync when `HAPPYTG_MINIAPP_PORT` changes.

### Added

- Mini App now exposes Projects/workspaces, shows Codex CLI runtime on session cards/details, and can create a Codex CLI session from a selected project.
- Caddy Mini App upstream can be overridden with `HAPPYTG_MINIAPP_UPSTREAM` for host-run Caddy setups such as `127.0.0.1:3007`.

### Verification

- Release validation covers Mini App project/session UI, API Mini App project/session endpoints, Caddy/Compose port separation, browser rendering, repo checks, and canonical task validation.

## v0.4.1

### Fixed

- Telegram bot replies no longer fail in local development when `HAPPYTG_PUBLIC_URL` or other Mini App URL settings resolve to local HTTP, localhost, private-network, or malformed `web_app.url` values. The bot now keeps ordinary replies and callback controls working while omitting invalid Web App buttons.
- Windows PowerShell Telegram `sendMessage` fallback errors now surface Telegram's JSON rejection description when available, instead of only the generic PowerShell `400 Bad Request` text.
- Production Mini App routing keeps the public Caddy `/miniapp` route, public Mini App auth/session and approval-action endpoints, and the `/telegram/webhook` delivery contract aligned.

### Added

- Added `pnpm happytg telegram menu set`, `--dry-run`, and `reset` for explicit Telegram persistent menu-button setup with public HTTPS URL validation and Caddy `/miniapp` preflight.
- `pnpm happytg doctor` and `pnpm happytg verify` now report Telegram Mini App URL, Caddy route, and menu-button setup guidance without mutating Telegram state.

### Changed

- Bot readiness reports Mini App launch-button status as diagnostic metadata without making local polling or normal bot replies unhealthy when no public HTTPS Mini App URL is configured.
- Release metadata is aligned at `0.4.1` across the workspace for the Telegram Mini App URL, menu-button, and production routing repair release.

### Verification

- Release validation covers bot sendMessage/Web App URL regression tests, bootstrap Telegram menu tests, repo typecheck/lint/test/build, and canonical task validation for the included proof bundles.

## v0.4.0

### Added

- Foundation contracts now include the canonical HappyTG state/event model, task phases, approval scopes, tool categories, daemon protocol contracts, Caddy topology, and repo-local `state.json` proof bundle metadata.
- Telegram bot UX now provides command-light `/start` and `/menu`, guided task wizard, session cards, host/session/approval browsing, scoped approval callbacks, and Mini App continuity links.
- Added `@happytg/session-engine` for reducer-backed session transitions, resume semantics, and transition tests.
- Added `@happytg/telegram-kit` for Telegram Mini App `initData` validation and compact signed launch payloads.
- Mini App launch grants, short-lived app sessions, dashboard/session/approval/host/report/diff/verify projections, mobile-first screens, and local draft recovery are now available.
- API now exposes fast `/version` and Prometheus `/metrics` endpoints, plus explicit Mini App session and launch-grant revoke paths.
- Self-hosted compose now includes Caddy, Prometheus, and Grafana scaffolding.

### Changed

- Control-plane session, approval, policy, proof-loop, and Mini App flows now build on the existing TypeScript monorepo instead of introducing a parallel runtime.
- API session moves now route through the reducer-backed state model where applicable.
- Approval resolution is nonce-aware and idempotent for retry-safe Telegram and Mini App actions.
- Policy evaluation now respects scoped policy layers without allowing lower scopes to weaken higher denies.
- Tool execution planning now classifies read, compute, mutation, sensitive, and deploy/publish actions with serial mutation lanes.
- CI and release workflows now run lint in addition to typecheck, test, and build.

### Security

- Structured logger metadata now redacts token, secret, password, authorization, API key, signing key, and related sensitive fields.
- Mini App launch payloads are signed, expiring, use-limited, and revocable; Mini App app-session tokens are hashed in state and revocable.
- Security hardening docs now define approval defaults, forbidden MVP operations, rotation, revocation, and audit checklist.

### Documentation

- Added architecture docs for foundation contracts, bot-first UX, session/policy/proof core, and Mini App rich UX.
- Added operations runbook, observability notes, security hardening guidance, and updated self-hosting/configuration docs for backup, upgrade, rollback, CORS, Mini App launch/session settings, Prometheus, and Grafana.

### Verification

- Release metadata is aligned at `0.4.0` across the workspace.
- Release validated with `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and canonical task validation for Wave 3, Wave 4, and Wave 5 proof bundles.

## v0.3.23

### Fixed

- `pnpm dev` no longer reports raw or misleading startup failures when the HappyTG Worker or HappyTG Bot port is already occupied by the same service. Both services now classify same-service reuse versus real conflicts instead of surfacing raw `listen EADDRINUSE` details.
- Worker startup no longer starts local maintenance work before bind success, so a reused worker port does not risk a second local runtime loop.
- Bot startup no longer starts a second Telegram delivery lifecycle on the same-service reuse path, while still reporting different-HappyTG-service and foreign-listener conflicts truthfully.

### Changed

- Quickstart and troubleshooting docs now include truthful occupied-port guidance for Bot `4100` and Worker `4200`.
- Release metadata is aligned at `0.3.23` across the workspace for the worker/bot startup port handling release.

## v0.3.22

### Fixed

- Interactive installer progress now renders one aggregate ASCII-safe progress bar for the full install flow, so long-running steps expose overall completion instead of looking frozen.
- Step completion accounting now stays truthful at the TUI layer: only `passed`, `warn`, `failed`, and `skipped` advance the aggregate bar, while `running` remains incomplete.
- Installer progress regression coverage now proves the shared bar appears both in the renderer and during the interactive planned-port rerun path.

### Changed

- Release metadata is aligned at `0.3.22` across the workspace for the installer progress-bar release.

## v0.3.21

### Fixed

- Installer repo sync no longer depends on checking out the requested local branch during `update/current` install flows. After fetch, HappyTG now resolves the fetched commit and detaches to that revision, so linked worktrees no longer block install with `'<branch>' is already used by worktree`.
- The installer still keeps the requested `--branch` semantics while preserving the existing dirty-worktree safety choices for `stash`, `keep`, and `cancel`.

### Changed

- Release metadata is aligned at `0.3.21` across the workspace for the installer remote-ref sync release.

## v0.3.20

### Fixed

- Installer/package-manager first-run no longer treats pnpm ignored build-script warnings as raw external noise or unconditional success. HappyTG now classifies the warning, validates the critical repo-local `tsx` plus `esbuild` path, and fails honestly only when that toolchain is actually broken.
- Bootstrap launcher wrappers no longer leak misleading `pnpm approve-builds` guidance on runtimes that do not support it. The shared installer bootstrap now normalizes ignored-build-scripts warnings into HappyTG-owned messaging while preserving the existing pnpm security posture.

### Changed

- Release metadata is aligned at `0.3.20` across the workspace for the installer pnpm warning guard release.

## v0.3.19

### Fixed

- Local Telegram polling on Windows no longer stays silently degraded when the machine can reach Telegram Bot API through PowerShell but Node/undici times out. `apps/bot` now retries transport-level `deleteWebhook` and `getUpdates` failures through a Windows PowerShell Bot API fallback, so `/start` and other inbound commands can keep working in local dev on affected hosts.
- Webhook inspection no longer reports a false degraded state on the same class of Windows hosts. `getWebhookInfo` now uses the same bounded fallback path, while real Telegram HTTP/API rejections still stay truthful and are not masked as success.
- When both Node HTTPS and the Windows PowerShell Bot API fallback fail, bot readiness and logs now report actionable transport diagnostics instead of a raw `fetch failed`.

### Changed

- Release metadata is aligned at `0.3.19` across the workspace for the Windows Telegram polling fallback follow-up release.

## v0.3.18

### Fixed

- Local HappyTG bot development no longer requires a public domain or manually configured Telegram webhook for baseline interaction. `apps/bot` now supports deterministic Telegram delivery mode selection and uses polling automatically when `HAPPYTG_PUBLIC_URL` is local, private, missing, or otherwise not webhook-capable.
- Telegram `/start` and `/pair <CODE>` now reach the local bot runtime during `pnpm dev` / `pnpm dev:bot`, preserving the existing `/api/v1/pairing/claim` boundary instead of silently bypassing current security checks.
- Webhook-first deployments no longer look falsely healthy when Telegram delivery is not actually configured. Bot startup logs and `/ready` now surface explicit degraded webhook state instead of a misleading generic `Bot listening` signal.

### Changed

- Bot runtime now shares one dispatcher between webhook and polling update intake, keeps explicit `webhook` mode from silently falling back to polling, and documents `TELEGRAM_UPDATES_MODE=auto|polling|webhook` in config and first-run docs.
- Release metadata is aligned at `0.3.18` across the workspace for the local Telegram polling follow-up release.

## v0.3.17

### Fixed

- Installer final-summary regression coverage now explicitly proves that the interactive flow releases stdin after `ENTER close`, so the shell-prompt return path is locked not only at the low-level `waitForEnter()` helper but also in the full `runHappyTGInstall` runtime harness.
- Existing-host pairing fallback coverage now stays honest across reuse, refresh, and manual-fallback branches, including the request-failed path that still needs a real manual `pnpm daemon:pair` handoff when the backend probe or code request cannot complete safely.

### Changed

- `executeHappyTG()` now exposes a narrow test-time runtime override seam, and `cli.test.ts` uses it to prove the `pnpm happytg install` wrapper preserves parsed install options, bootstrap-check delegation, and the installer result contract without mutating `tuiHandled`.
- Release and proof artifacts now include a completed installer final-summary/exit bundle plus dedicated CLI/runtime/TUI regression evidence for the post-`0.3.16` follow-up hardening.

## v0.3.16

### Fixed

- Installer pairing finalization no longer treats any existing local `hostId` as a blind reuse/manual fallback case. It now probes the HappyTG backend to distinguish already paired or active hosts from merely registered hosts before deciding whether to reuse the host or refresh the pairing code.
- When prerequisites are ready and an existing host is still `registering`, `pnpm happytg install` now auto-requests a fresh pairing code during install and renders the concrete Telegram handoff instead of requiring a separate manual `pnpm daemon:pair` step.
- Existing paired or active hosts now stay on a truthful reuse path without emitting a new pairing code, while invalid-token and probe-unavailable paths keep honest blocked/manual diagnostics.
- Installer finalization no longer adds contradictory daemon-start follow-up when pairing is still blocked, and regression coverage now locks the no-state auto-request, existing-host refresh, existing-host reuse, invalid-token block, and probe-unavailable manual-fallback branches.
- Interactive installer final summary now closes cleanly on `Enter`, releases stdin, and lets the shell prompt return instead of hanging on the closing screen.

### Changed

- Release metadata is aligned at `0.3.16` across the workspace for the installer pairing handoff automation release.
- API startup regression coverage now tolerates slower transient port handoffs on this host, keeping the guarded release test gate stable without changing runtime behavior.

## v0.3.15

### Fixed

- Interactive installer port preflight now resolves real planned-port conflicts before later startup guidance instead of leaving them as passive warnings only. When a port is occupied by a foreign listener or the wrong HappyTG service, the installer shows the current owner, distinguishes supported reuse from conflict, offers 3 nearby free ports, accepts manual entry, and lets the user abort without a hidden rebind.
- Bootstrap planned-port diagnostics now keep the explicit env precedence intact while exposing three non-colliding nearby free ports for conflicts, preserving `HAPPYTG_*_PORT` first and `PORT` fallback for app services without regressing existing reuse detection.
- Bootstrap/install regression coverage now locks the new port-remediation UX for foreign listeners, supported reuse, suggested-port selection, manual overrides, and explicit refusal to continue.

### Changed

- Installation, quickstart, and troubleshooting docs now describe the installer’s explicit port-choice flow and how the selected `HAPPYTG_*_PORT` override is written back to `.env`.
- Release metadata is aligned at `0.3.15` across the workspace for the installer port preflight UX follow-up release.

## v0.3.14

### Fixed

- Installer finalization now keeps the detected problem separate from its remediation path, so install/setup/doctor output can render solution bullets instead of burying the fix inside one long sentence.
- Plain-text and TUI install summaries now render structured warning/conflict/problem guidance consistently, including dedicated remediation bullets for port conflicts, Telegram/token blockers, and Codex PATH follow-up.
- Bootstrap installer regression coverage now directly exercises the TUI warning-item `solutions` path, and the remaining installer runtime tests stay hermetic against maintainer-local daemon state.

### Changed

- Release metadata is aligned at `0.3.14` across the workspace for the structured installer remediation follow-up release.

## v0.3.13

### Fixed

- Windows bootstrap no longer leaves Telegram bot validation in a warning-only state when Node HTTPS/undici times out to `api.telegram.org` but a same-token Windows PowerShell `getMe` probe can still validate the bot.
- Windows bot runtime no longer drops outbound `sendMessage` replies on transport throws from Node HTTPS; it now retries through the PowerShell Bot API path and keeps real Telegram HTTP/API failures truthful.
- Bootstrap and bot regression coverage now explicitly locks the validated Windows fallback path while preserving invalid-token and Telegram API failure classification.

### Changed

- Release metadata is aligned at `0.3.13` across the workspace for the Windows Telegram transport fallback release.

## v0.3.12

### Fixed

- Install finalization no longer relies on a flat `nextSteps: string[]` list. Bootstrap/install now classify follow-up as `auto`, `manual`, `warning`, `reuse`, `conflict`, or `blocked`, and the final install output is derived from that structured model.
- Safe local install-finalization work is now performed during the flow when possible. In particular, the installer can auto-request a host pairing code when prerequisites are satisfied, while keeping the Telegram `/pair <CODE>` handoff explicit and manual.
- Pair/background guidance now reflects the actual post-install state instead of the requested mode only. The final summary no longer claims that a launcher was configured when setup fell back to manual, and blocked Telegram validation now suppresses false pair instructions.
- Overlapping infra and stack guidance is deduplicated across setup/doctor/verify/install surfaces so reuse hints, conflicts, and manual steps no longer contradict one another or repeat the same advice in multiple sections.
- Install summaries now suppress duplicate warning text when the same condition is already represented as a structured conflict, keeping plain-text/TUI output concise without hiding real environment constraints.

### Changed

- Plain-text and TUI final summaries now render grouped sections for auto-run, requires-user, blocked, reuse, conflicts, and warnings, while legacy `nextSteps` remains a compatibility subset for pending manual/blocked actions only.
- Release metadata is aligned at `0.3.12` across the workspace for the install finalization automation release.

## v0.3.11

### Fixed

- Windows bootstrap no longer misreports a broken external `NODE_OPTIONS=--require ...` preload path as `Node.js 22+ is still not available on PATH` when Node is actually installed.
- PowerShell and shell bootstrap wrappers now distinguish stale external preload contamination from missing preloads inside `HAPPYTG_BOOTSTRAP_DIR` or the selected workspace, keeping external poison recoverable while preserving truthful hard failures for HappyTG-managed paths.
- Interactive install progress now uses ASCII-safe running and pending indicators again, restoring readable active-step rendering on Windows terminals instead of degrading into an unstable purple glyph.

### Changed

- Installer warning classification and final-summary guidance stay truthful for real environment warnings such as Telegram transport-specific lookup failures, Codex websocket `403` fallback, and Mini App port `3001` conflicts.
- Release metadata is aligned at `0.3.11` across the workspace for the bootstrap/install regression follow-up release.

## v0.3.10

### Fixed

- Telegram installer `getMe` warnings now call out the Node/undici HTTPS path explicitly, point to concrete proxy env vars (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`), and mention IPv4/IPv6 routing differences instead of vaguely attributing the issue to "Node or curl" without evidence.
- Installer final next steps now drop contradictory `pnpm dev` guidance when post-checks already detected a running HappyTG stack, and they collapse overlapping shared-infra / Redis / running-stack advice into a single truthful path.
- The interactive installer no longer re-renders the exact same final screen on `ENTER`, removing duplicate `Final Summary` captures in transcript/log output while preserving the final confirmation flow.

### Changed

- Release metadata is aligned at `0.3.10` across the workspace for the diagnostics wording and installer-summary follow-up release.

## v0.3.9

### Fixed

- Telegram installer `getMe` diagnostics now run a safe Windows PowerShell follow-up probe after Node HTTPS transport failures so HappyTG can distinguish Node/curl-specific Bot API timeouts from invalid tokens and from broader Bot API reachability issues.
- Telegram warning text now explains why Telegram Desktop working on the same host does not automatically clear Bot API HTTPS failures, and invalid-token follow-up probes now stay classified as invalid token instead of degrading into a vague API warning.
- Codex smoke warnings now say when the Responses websocket returned `403 Forbidden` but the CLI successfully fell back to HTTP, keeping the warning truthful while making its non-blocking nature explicit.
- Installer post-check output now compresses repeated `setup`/`doctor`/`verify` warning sets and semantically deduplicates overlapping `pnpm dev`, pairing, and daemon-start next steps in the final summary.

### Changed

- Release metadata is aligned at `0.3.9` across the workspace for the installer publish-flow follow-up release.

## v0.3.8

### Fixed

- Telegram `getMe` diagnostics now distinguish DNS, timeout, TLS, proxy, HTTP, and non-JSON failures instead of collapsing them into a generic `fetch failed` warning.
- Windows Codex wrapper detection and smoke checks no longer produce contradictory repeated PATH and smoke-failure warnings when the npm-installed `codex.cmd` wrapper is runnable.
- Planned-port diagnostics now attribute listeners, distinguish supported reuse of local Redis/Postgres/MinIO services from real conflicts, and suggest non-colliding alternative ports for actual conflicts such as Mini App port `3001`.

### Changed

- Final installer/setup/doctor/verify summaries are now deduplicated against the full planned-port set and keep only truthful environment warnings after the diagnostics fixes land.
- Release metadata is aligned at `0.3.8` across the workspace for the installer diagnostics follow-up release.

## v0.3.7

### Fixed

- Interactive installer Telegram token entry now starts blank instead of reusing persisted token values from `.env` or saved draft state.
- The Telegram token reducer keeps supporting clear-then-paste replacement, so replacing a token after deleting the existing draft remains stable in the interactive flow.
- Interactive installer coverage now asserts that pre-existing token state does not leak back into the initial Telegram screen while freshly pasted tokens still save normally.

### Changed

- Release metadata is aligned at `0.3.7` across the workspace for the Telegram token field follow-up release.

## v0.3.6

### Fixed

- Windows installer Telegram input now commits pasted terminal chunks that already include trailing newline or CRLF, so bot tokens and allowed user IDs survive real interactive paste flows.
- Telegram allowed user ID normalization now accepts comma- or newline-separated pasted values without regressing typed editing, masking, or token validation.
- Bootstrap Redis guidance now names supported non-Docker alternatives such as existing `REDIS_URL` / shared-service endpoints instead of implying Docker Compose is the only viable path.

### Changed

- Release metadata is aligned at `0.3.6` across the workspace for the Windows installer paste and dockerless-guidance follow-up release.

## v0.3.5

### Fixed

- Installer final summaries now aggregate warning-level follow-up from `setup`, `doctor`, and `verify` post-checks instead of dropping those findings after step-local rendering.
- Repeated Windows `CODEX_PATH_PENDING` follow-up from the three post-checks is now deduplicated into one final warning and one actionable PATH next step.
- Warning-only Windows install runs now keep both Telegram lookup warnings and Codex PATH follow-up visible in the final installer summary without regressing back to a recoverable failure state.

### Changed

- Release metadata is aligned at `0.3.5` across the workspace for the Windows installer post-check summary follow-up release.

## v0.3.4

### Fixed

- Windows bootstrap now detects runnable Codex wrappers in standard user npm bin directories such as `%APPDATA%\\npm` even when `npm prefix -g` probing is unavailable in the current shell.
- Installer post-checks no longer escalate that Windows APPDATA wrapper case into a false missing-Codex recoverable failure; the outcome now stays at warning level with explicit PATH follow-up guidance.
- `CODEX_PATH_PENDING` diagnostics now include the recovered wrapper directory in both findings and next-step text, making the fix actionable instead of generic.

### Changed

- Release metadata is aligned at `0.3.4` across the workspace for the Windows APPDATA Codex wrapper follow-up release.

## v0.3.3

### Fixed

- Installer Telegram diagnostics now distinguish invalid token/config problems from recoverable `getMe` lookup failures such as fetch/network errors.
- Installer now preserves an already-known `TELEGRAM_BOT_USERNAME` for pair guidance when live Telegram identity lookup is the only failing layer, so configured bots no longer look fully unconfigured after a secondary lookup warning.
- Windows installer/bootstrap follow-up checks now recover through runnable npm-installed Codex wrappers and downgrade that state to a PATH follow-up warning instead of cascading into a false missing-Codex failure.
- Windows npm global bin injection inside the installer now uses normalized PATH handling, avoiding mixed-case `Path` / `PATH` loss that could make post-check execution more brittle.
- Plain-text installer summaries now show Telegram as configured with an identity-lookup warning/failure when appropriate, reducing contradictory user-facing output.

### Changed

- Release metadata is aligned at `0.3.3` across the workspace for the Windows installer/runtime diagnostics follow-up release.

## v0.3.2

### Fixed

- Installer TUI now renders Telegram bot token input as a masked preview that preserves the first 4 and last 4 characters, keeps the raw secret in persisted state only, and degrades safely for short values.
- Telegram setup validation now blocks incomplete values such as missing BotFather tokens or `@botname` usernames before runtime execution, keeping interactive and non-interactive installer failures installer-native.
- Installer completion now normalizes outcomes across success, warning-only success, recoverable failure, and fatal failure so warning-only Telegram lookup issues no longer appear as contradictory `[FAIL]` summaries.
- Final installer screens now close cleanly from `ENTER close`, and interactive installs no longer fall through to an extra plain-text summary after the TUI screen has already resolved.
- Structured install results now distinguish warning-only outcomes from recoverable partial failures, including completed runs where follow-up steps such as post-checks still need attention.

### Changed

- Release metadata is aligned at `0.3.2` across the workspace for the installer UX/runtime follow-up release.

## v0.3.1

### Fixed

- Installer runtime failures now stay inside installer-native handling instead of falling through to the top-level CLI usage banner.
- Repo sync now retries transient remote failures 5 times, surfaces attempt progress, and automatically switches to the configured fallback source before returning a structured failure.
- Windows command execution now normalizes generic npm-style shims such as `pnpm.cmd`, recovers from broken shim launches where safe, and reports actionable structured failures when spawn still fails.
- Installer reruns now resume from persisted onboarding state so Telegram bot token, allowed user IDs, home channel, background mode, repo location, repo source, and post-check choices do not need to be re-entered after a failed run.
- Telegram setup input now handles pasted multi-character chunks without breaking raw-mode editing, cursor flow, or retro TUI navigation.

### Changed

- Release metadata is aligned at `0.3.1` across the workspace for the installer resilience update.

## v0.3.0

### Added

- Introduced `happytg install` as the unified one-command installer inside the existing bootstrap CLI.
- Added retro TUI onboarding screens for preflight, repo mode selection, Telegram setup, background run mode, progress, and final summary.
- Added cross-platform installer shims at `scripts/install/install.sh` and `scripts/install/install.ps1` that bootstrap the repo and hand off to the shared TypeScript installer flow.

### Changed

- Installer onboarding is now Telegram-first only and collects `TELEGRAM_BOT_TOKEN`, allowed user IDs, and home channel during installation.
- Repository onboarding now supports clone, update, and current-directory modes with safe dirty-worktree handling and idempotent `.env` merge behavior.
- Pairing/setup guidance now reuses the configured Telegram bot identity so `/pair <CODE>` instructions point to the correct bot automatically.
- Release metadata is aligned at `0.3.0` across the workspace for the installer launch.

### Docs

- Rewrote first-run instructions in [README](./README.md), [Installation](./docs/installation.md), [Quickstart](./docs/quickstart.md), [Bootstrap Doctor](./docs/bootstrap-doctor.md), and [Configuration](./docs/configuration.md) around the new one-command installer.

## v0.2.0

### Fixed

- Hardened Windows home resolution so `~` and `~/...` respect env-driven home overrides consistently, including Windows-style env-key casing.
- Hardened Codex detection for Windows PATH shim scenarios such as `codex.cmd`, mixed `Path` / `PATH`, and mixed `PATHEXT` casing.
- Clarified bootstrap diagnostics so "Codex CLI not found" is reserved for true missing-binary cases instead of broken-but-present installs.

### Docs

- Refined GitHub-facing onboarding in [README](./README.md), [Quickstart](./docs/quickstart.md), [Installation](./docs/installation.md), [Bootstrap Doctor](./docs/bootstrap-doctor.md), and [Troubleshooting](./docs/troubleshooting.md).
- Replaced path-like navigation labels with document-title links where that improved first-run readability.

## v0.1.0

Первый зафиксированный релиз HappyTG.

### Что вошло

- кроссплатформенный first-run path для Windows/macOS/Linux
- более понятный onboarding и диагностика для Codex CLI, pairing и miniapp
- обработка конфликтов порта miniapp без unhandled stack trace
- снижение шума в `host-daemon` при ожидаемых first-run состояниях
- структурированный plain-text вывод для `happytg doctor` / `verify`
- progress indicator по proof loop в Mini App
- `happytg doctor` остаётся зелёным при известных benign warning'ах Codex CLI, при этом подробная диагностика сохраняется в `--json`
- обновлённые инструкции первого старта и запуска

### Проверки

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm lint`

### Тег релиза

- `v0.1.0`
