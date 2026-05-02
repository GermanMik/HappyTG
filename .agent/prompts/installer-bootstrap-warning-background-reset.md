# Installer Bootstrap Warning, Docker Reuse, And Caddy Safety Repair Prompt

Use this prompt when the Windows one-line installer prints a scary pnpm build-script warning even though the bootstrap preflight succeeded, when Docker launch mode makes the current background run-mode UX confusing or leaves stale Windows autostart artifacts from previous installs, or when Docker mode starts duplicate infra/Caddy containers instead of safely reusing healthy system services.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Create or switch to a dedicated repair branch before changing production code:

```powershell
git switch -c codex/installer-bootstrap-warning-background-reset
```

If the branch already exists, switch to it without discarding local user changes. Do not use `git reset --hard`, `git checkout --`, or destructive cleanup unless the user explicitly asks.

## Current User-Reported Problems

The operator runs the public Windows installer command:

```powershell
irm https://raw.githubusercontent.com/GermanMik/HappyTG/main/scripts/install/install.ps1 | iex
```

Problem 1: the installer emits this warning during shared bootstrap preparation:

```text
WARNING: pnpm ignored build scripts while preparing the shared installer bootstrap, but the repo-local tsx/esbuild
preflight passed. Continuing with the installer. This pnpm runtime does not support pnpm approve-builds; if a later
bootstrap dlx run fails, allow the blocked packages in your pnpm build-script policy and rerun.
```

This is confusing because the preflight already proved the critical temporary `tsx`/`esbuild` path works and the real repo-local `pnpm install` path has its own ignored-build-script assessment later.

Problem 2: if the install is planned to run through Docker Compose, the current `Background Run Mode` menu appears before or without enough context from the launch-mode decision and feels meaningless to the operator:

```text
Background Run Mode
Windows background daemon preference

> Scheduled Task
   Create a logon task that starts the host daemon.
  Startup
   Create a Startup entry that runs the host daemon on login.
  Manual
   Keep daemon startup manual with `pnpm dev:daemon`.
  Skip
   Do not configure any background run mode.
```

The installer also needs to detect stale services/autostart entries from previous installs, remove all HappyTG-owned background launchers for the selected state scope, then apply the newly selected mode. Selecting `Manual` or `Skip` must also remove old HappyTG autostart artifacts.

Problem 3: after choosing Docker mode, the installer can finish with warnings that do not make the next action clear. The final screen/report must not leave the operator guessing whether Docker already started the stack, whether they still need `pnpm dev`, whether they need `pnpm dev:daemon`, or which command should be used to inspect/restart the Docker installation.

Treat the exact warning text from the reproduced install as primary evidence. If the warning text is unavailable, first reproduce a Docker-mode install in a sanitized local/test environment or with injected command results before deciding which warnings are product bugs and which are valid follow-up guidance.

Problem 4: Docker mode currently treats already-occupied infra/Caddy ports mostly as remap work. If Redis or Caddy is already available on the host, the installer can still start duplicate Compose services such as `redis-1` and `caddy-1`. That is wrong when the operator wants to reuse existing system services. The Docker installer must ask whether to reuse existing services or run an isolated Docker stack, then make the resulting Compose command match that choice.

Concrete repro evidence to preserve:

- Docker Desktop shows a HappyTG Compose project with `redis-1` running on `6380:6379` even though a system Redis already exists and setup should have offered reuse.
- Docker Desktop shows `caddy-1` present but stopped/not running while a system Caddy already exists. The installer must not create Caddy conflicts blindly.
- The operator expects the installer to first check whether HappyTG Caddy routes were already added to the system Caddy config. If they exist and validate, reuse system Caddy. If they do not exist, offer either to print the required config or to patch Caddy only after double confirmation of the risks.

## Mandatory Startup Discipline

Follow repository instructions exactly:

1. Retrieve EchoVault context first:
   - `memory context --project`
   - `memory search "installer pnpm ignored build scripts approve-builds bootstrap warning"`
   - `memory search "installer docker background mode scheduled task startup uninstall ownedArtifacts"`
   - `memory search "installer docker redis caddy reuse existing services compose profiles"`
   - fetch details for relevant memories, especially the uninstall ownership cleanup, Docker launch-mode, Docker infra port-remap, and Caddy port repair memories.
2. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` before production edits:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `task.json`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
3. Freeze scope in `spec.md` before build.
4. Keep builder and verifier roles separate. The verifier must not edit production code.
5. Use minimal fixes. Do not rewrite installer architecture, Docker topology, or host-daemon ownership unless evidence proves it is necessary.

Recommended task id: `HTG-2026-05-01-installer-bootstrap-warning-background-reset`.

## Architecture Constraints

- Telegram is not the internal transport for agent events.
- Mutating host operations still run through strict serialized queues where relevant.
- The host daemon remains outside Docker Compose because it needs host repository and Codex access.
- Docker Compose launch mode starts the packaged control-plane stack only.
- Do not silently containerize the host daemon or imply Docker Compose replaces host daemon pairing/startup unless the architecture is intentionally changed and separately approved.
- Docker service reuse must be an explicit installer choice. Do not silently decide between host services and isolated Compose containers after the user selected Docker.
- System Caddy is operator-owned. HappyTG may only print config by default, or patch clearly marked HappyTG-managed blocks after explicit double confirmation.
- Higher-level policy cannot be weakened by install UX changes.

## Goal

Make the installer output and background startup behavior match what the operator actually selected:

1. The public PowerShell installer should not show a `WARNING:` for the shared bootstrap ignored-build-scripts case when the bootstrap preflight marker passed and the installer can safely continue.
2. Any ignored-build-script message that remains must be truthful, actionable, and tied to a real risk or failure.
3. The launch-mode and background-mode UX must make Docker Compose semantics clear.
4. Before configuring the selected background mode, the installer must clean stale HappyTG-owned background artifacts from previous installs for the current safe state scope.
5. The selected new background mode must be the only active HappyTG background launcher after a successful install.
6. Docker-mode completion output must plainly say what is already running, what still must run on the host, and which commands the operator should use next.
7. Expected Docker-mode follow-ups must not be rendered as scary generic warnings; real blockers must stay visible and actionable.
8. Docker mode must ask whether to reuse healthy system services or run an isolated Compose stack.
9. Reuse mode must not start duplicate Compose services for Redis/Postgres/MinIO/Caddy when those services are selected for reuse.
10. Caddy reuse must first detect existing HappyTG routes, then either reuse, print a snippet, or patch only with double confirmation.

## Required Investigation Scope

Inspect these areas first:

- `scripts/install/install.ps1`
  - `Invoke-SharedInstallerBootstrapPreflight`
  - `Test-IgnoredBuildScriptsWarning`
  - `Test-PnpmApproveBuildsSupport`
  - `Run-SharedInstaller`
- `packages/bootstrap/src/install/index.ts`
  - `backgroundOptionsForPlatform`
  - `launchOptionsForInstall`
  - interactive prompt order for background/launch mode
  - `runPnpmInstall` ignored-build-script handling
  - `resolvePortConflictsBeforePostChecks`
  - finalization item construction
  - warning collection/deduplication for Docker launch, post-checks, and finalization items
  - `renderSummaryScreen` inputs and `nextSteps` generation
  - any future Docker service strategy selection and persistence
- `packages/bootstrap/src/install/tui.ts`
  - `renderBackgroundModeScreen`
  - `renderLaunchModeScreen`
  - `renderSummaryScreen`
  - any future service strategy/Caddy action screens
- `packages/bootstrap/src/install/launch.ts`
  - Docker Compose command construction
  - service selection, profiles, generated override files, or any other mechanism used to skip reused services
  - `COMPOSE_*` env propagation into container services
- `packages/bootstrap/src/install/background.ts`
  - `configureBackgroundMode`
  - Windows Scheduled Task creation
  - Windows Startup shortcut creation
  - macOS LaunchAgent and Linux systemd-user paths if the reset can be cross-platform
- `packages/bootstrap/src/install/state.ts`
  - `ownedArtifacts`
  - state merge behavior across repeated installs
- `packages/bootstrap/src/uninstall/index.ts`
  - safe ownership cleanup rules
  - default state scope vs custom `HAPPYTG_STATE_DIR`
- Docker/Caddy config:
  - `infra/docker-compose.example.yml`
  - `infra/caddy/Caddyfile`
  - docs for host-run Caddy and public Mini App URL behavior
- Relevant tests:
  - `packages/bootstrap/src/install.runtime.test.ts`
  - `packages/bootstrap/src/install.scripts.test.ts`
  - `packages/bootstrap/src/install.state.test.ts`
  - `packages/bootstrap/src/uninstall.test.ts`
  - `packages/bootstrap/src/cli.test.ts`
  - `packages/bootstrap/src/infra-config.test.ts`
- Docs if final instructions are documented:
  - `docs/installation.md`
  - `docs/quickstart.md`
  - `docs/self-hosting.md`
  - `docs/troubleshooting.md`

## Explicit Questions To Answer In Evidence

1. Why does `install.ps1` emit a PowerShell `WARNING:` when `pnpm dlx tsx --eval ...` succeeds and prints the bootstrap marker?
2. Does suppressing or demoting that bootstrap warning hide any real failure that is not caught later by repo-local `pnpm install` and `PNPM_TOOLCHAIN_CHECK_COMMAND`?
3. Which code currently decides the order of `Background Run Mode` and `Launch Mode` screens?
4. In Docker launch mode, what exactly still needs to run on the host, and how should the UI name that choice so it does not look like Docker service startup?
5. What stale artifacts can exist after repeated installs on Windows?
   - Scheduled Task `HappyTG Host Daemon`
   - Startup shortcut `HappyTG Host Daemon.cmd`
   - local launcher script under HappyTG state
6. Which stale artifacts should be cleaned on macOS/Linux for parity?
7. How does the cleanup stay safe for custom `HAPPYTG_STATE_DIR` and unowned global launchers?
8. What happens when the selected new mode is `Manual` or `Skip`?
9. Which warnings appear after a successful Docker-mode install, and which are expected guidance vs real problems?
10. Does the final screen currently tell the operator whether Docker Compose has already started `happytg-*` containers?
11. Does Docker-mode final guidance incorrectly tell the operator to run `pnpm dev` for the control-plane stack?
12. Does Docker-mode final guidance clearly separate:
    - control-plane stack in Docker Compose;
    - host daemon on the Windows/macOS/Linux host;
    - Telegram menu/public URL setup;
    - verification/inspection commands?
13. Which code currently turns "Redis/Postgres/MinIO/Caddy port occupied" into Docker remap instead of service reuse?
14. What Compose mechanism will cleanly skip reused services without leaving invalid `depends_on` edges?
15. When Redis is reused from the host, what exact `COMPOSE_REDIS_URL` should containers receive on Windows/macOS/Linux?
16. How should Postgres/MinIO reuse be represented if their host URLs are configured but Docker containers need host access?
17. How can the installer detect a system Caddy installation and candidate Caddyfile paths without mutating them?
18. How can it detect an existing HappyTG Caddy block safely?
19. What is the exact Caddy snippet for host-run system Caddy when API/Bot/Mini App are running in Docker and exposed through host ports?
20. What double-confirmation text makes the Caddy patch risk explicit enough before editing an operator-owned reverse proxy?

## Expected Fix Shape

Prefer a small, auditable repair.

For the PowerShell bootstrap warning:

- Keep hard failure if the bootstrap `pnpm dlx tsx --eval ...` command exits non-zero.
- Keep hard failure if the expected bootstrap marker is absent.
- When ignored build scripts are reported but the marker is present, do not use `Write-Warning`.
- Either suppress the message entirely or print a short non-warning informational line such as:

```text
pnpm reported ignored build scripts during temporary bootstrap, but HappyTG verified the required tsx/esbuild path. Continuing; repo install will re-check.
```

- Do not tell users to run unsupported `pnpm approve-builds` in the success path.
- Preserve richer `pnpm approve-builds` / pnpm policy guidance for the real repo-local `pnpm install` assessment in `packages/bootstrap/src/install/index.ts`.

For Docker/background UX:

- Prefer selecting `Launch Mode` before host daemon background startup, or otherwise make the background screen render with launch-mode context.
- Rename or reframe the screen so Docker mode is clear. For example:
  - title: `Host Daemon Startup`
  - subtitle in Docker mode: `Docker starts the control-plane stack; the host daemon still runs on Windows.`
- Keep choices only if they are truly about the host daemon, not Docker services:
  - Scheduled Task: start host daemon on user logon.
  - Startup: start host daemon from Startup on login.
  - Manual: keep host daemon manual with `pnpm dev:daemon`.
  - Skip: do not configure host daemon background startup.
- If the spec proves Docker mode should skip host-daemon startup configuration entirely, document the architectural reason and make final guidance explicit. Do not silently skip the host daemon if pairing or local repo execution still needs it.

For stale background cleanup:

- Add a preconfigure cleanup step before applying the selected background mode.
- The cleanup must remove all known HappyTG-owned background artifacts for the current safe state scope before creating the selected new launcher.
- On Windows, remove both:
  - Scheduled Task `HappyTG Host Daemon`
  - Startup shortcut `~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/HappyTG Host Daemon.cmd`
- Also remove stale HappyTG launcher scripts under the local state dir when they are no longer the selected mode's launcher.
- Selecting `Manual` or `Skip` should leave no HappyTG Scheduled Task or Startup shortcut active.
- Reuse or refactor existing uninstall cleanup logic where practical, but keep install-time reset scoped and testable.
- Preserve safe-by-default behavior:
  - recorded `ownedArtifacts` can be cleaned;
  - default state scope can clean default HappyTG-named global artifacts;
  - custom `HAPPYTG_STATE_DIR` must not delete default global artifacts unless ownership was recorded.
- The final install state should record only the selected current background result plus any truthful ownership metadata needed for later uninstall.

For Docker post-install warnings and final guidance:

- Audit every warning/finalization item emitted after a Docker-mode install.
- Classify messages into:
  - `done`: already completed by installer, such as Compose stack started;
  - `manual`: required operator action, such as pairing or manually starting host daemon if no background launcher was configured;
  - `warning`: non-blocking but important, such as Caddy public HTTPS not production-ready after local port remap;
  - `blocked`: install or startup did not complete.
- Do not show completed Docker startup as a pending next step.
- Do not tell Docker-mode users to run `pnpm dev` to start the control-plane stack after `docker compose ... up --build -d` already succeeded.
- If host daemon startup still requires action, say that explicitly and only for the host daemon:

```text
Docker Compose stack: started.
Inspect: docker compose --env-file .env -f infra/docker-compose.example.yml ps
Host daemon: not inside Docker. Start it with pnpm dev:daemon, or use the selected Scheduled Task/Startup launcher after login.
Pairing: if not paired, run pnpm daemon:pair and send the /pair code to the bot.
Telegram Mini App: set/update the menu only after HAPPYTG_PUBLIC_URL/HAPPYTG_MINIAPP_URL points to a reachable public HTTPS /miniapp URL.
```

- If a Windows Scheduled Task or Startup launcher was selected and configured successfully, do not phrase host daemon startup as an immediate mandatory manual step. Say it starts on next login and provide `pnpm dev:daemon` only as an optional "start now" action.
- If `Manual` was selected, make `pnpm dev:daemon` the clear next step.
- If `Skip` was selected, say no host-daemon autostart was configured and that the daemon must be started manually when host operations are needed.
- Include Docker day-2 commands in the final output:
  - inspect: `docker compose --env-file .env -f infra/docker-compose.example.yml ps`
  - logs: `docker compose --env-file .env -f infra/docker-compose.example.yml logs -f`
  - restart/start: `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d`
  - stop: `docker compose --env-file .env -f infra/docker-compose.example.yml down`
- If the install finishes with warnings, the final screen must make clear whether HappyTG is usable now, usable after one named action, or blocked.
- Keep JSON output and plain-text CLI output consistent with the TUI final screen.

For Docker service strategy:

- After `Launch Mode` is set to Docker, add a Docker service strategy decision before port remap/Compose startup:
  - `Reuse existing system services` should be the recommended/default option when setup finds healthy Redis/Postgres/MinIO/Caddy or configured endpoints that can be validated.
  - `Isolated Docker stack` should start HappyTG-owned service containers and use the existing remap behavior when host ports are occupied.
- The choice must be visible in TUI, JSON, and final text output.
- Reuse mode must physically avoid starting the reused Compose services. Do not accept a fix that merely remaps their host ports while still creating duplicate `redis-1`, `postgres-1`, `minio-1`, or `caddy-1` containers.
- Use the smallest maintainable Compose mechanism that preserves normal isolated mode. Acceptable directions include profiles, generated Compose override files, or service-targeted `docker compose up` commands. The chosen mechanism must be documented in the proof bundle.
- Reuse mode must pass container-reachable endpoints into app containers:
  - Redis: set `COMPOSE_REDIS_URL` from the existing `REDIS_URL`, translated to a Docker-reachable host address when the URL points at localhost/127.0.0.1 on Windows/macOS/Linux.
  - Postgres: set `COMPOSE_DATABASE_URL` from `DATABASE_URL` when Postgres is reused.
  - MinIO/S3: set `COMPOSE_S3_ENDPOINT` from `S3_ENDPOINT` when S3-compatible storage is reused.
- If a configured endpoint is not reachable from containers, stop before Compose startup and ask the operator to choose isolated mode or provide a container-reachable endpoint.
- Isolated mode must keep current behavior for remapping busy ports, but the final screen must explicitly say that separate Docker containers were started.
- Non-interactive mode must not guess risky reuse vs isolated semantics. Preserve the existing default unless new explicit flags are added and documented.

For system Caddy reuse and safety:

- Detect whether Caddy is already installed/running on the host and whether ports 80/443 are already owned by Caddy.
- Check previously entered HappyTG project data before asking for changes:
  - `.env` values such as `HAPPYTG_DOMAIN`, `HAPPYTG_PUBLIC_URL`, `HAPPYTG_MINIAPP_URL`, `HAPPYTG_HTTP_PORT`, `HAPPYTG_HTTPS_PORT`, and `HAPPYTG_MINIAPP_UPSTREAM`.
  - persisted install state if it records public URL, Caddy action, Caddyfile path, or prior snippet/patch status.
  - common Caddy config locations and any user-provided Caddyfile path.
  - existing Caddy config text for HappyTG markers, `HAPPYTG_DOMAIN`, `/miniapp`, `/telegram/webhook`, the Mini App public API allowlist, and upstreams to HappyTG API/Bot/Mini App.
- If a valid HappyTG Caddy route is already present and `caddy validate` plus route preflight pass, reuse system Caddy and report it as `reuse`, not `warning`.
- If system Caddy exists but HappyTG routes are missing, offer:
  - `Print Caddy snippet` as recommended/default. It must not edit files. It should print or write a generated snippet plus exact `caddy validate` and `caddy reload` commands.
  - `Patch Caddyfile` as an advanced/risky action.
- Patching Caddyfile requires double confirmation:
  - first confirmation selects the risky patch path;
  - second confirmation appears after showing target path, backup path, proposed diff/managed block, validate command, reload command, rollback command, and the warning that this changes the operator-owned system reverse proxy.
- Patch behavior must:
  - create a backup before writing;
  - touch only a clearly marked HappyTG-managed block;
  - avoid modifying unrelated site blocks;
  - run `caddy validate` before reload;
  - reload only after validation passes;
  - provide rollback guidance if validation or reload fails;
  - never run in non-interactive mode unless explicit flags are added with the same safety contract.
- If system Caddy is reused, Docker mode must not start the Compose `caddy` service. The final screen must say whether Caddy was already configured, snippet was printed, or patch was applied.
- Caddy remains necessary for public Telegram Mini App and webhook HTTPS routes. It is not required merely for local container health checks, so a stopped/skipped `caddy-1` is acceptable only when system Caddy is explicitly reused or Caddy is explicitly skipped for local-only operation.

## Suggested Tests

Add targeted regression tests before broad repo checks.

PowerShell bootstrap:

- `install.ps1` bootstrap preflight succeeds, output contains ignored-build-script text, and the script does not emit `WARNING:` in the success path.
- If the bootstrap marker is absent or `pnpm dlx tsx` fails, the installer still fails honestly.
- Existing repo-local ignored-build-script tests in `install.runtime.test.ts` still warn/fail according to critical `tsx`/`esbuild` health.

Interactive UX:

- Interactive install asks for launch mode before background mode, or the background renderer receives launch-mode context.
- In Docker mode, the background screen text makes clear the choices are for the host daemon, not the Docker Compose control-plane stack.
- Local/manual/skip launch modes keep sensible copy and defaults.

Docker final guidance and warnings:

- Successful Docker launch finalization shows Docker Compose as already started and includes the exact inspect/log/restart commands.
- Successful Docker launch finalization does not include `pnpm dev` as the control-plane startup command.
- If Scheduled Task or Startup was configured, finalization describes host daemon autostart as configured for next login and `pnpm dev:daemon` as optional immediate start.
- If Manual background mode was selected, finalization lists `pnpm dev:daemon` as the host-daemon action.
- If Skip background mode was selected, finalization says no host-daemon autostart was configured and gives manual recovery guidance.
- Warnings emitted after Docker mode are deduplicated and categorized; expected host-daemon separation guidance is not presented as a generic warning.
- If Docker launch fails, finalization remains blocked and includes the failing Docker command plus next recovery command.
- JSON, CLI text, and TUI summary expose the same Docker-mode next-action model.

Docker service strategy:

- Interactive Docker install asks whether to reuse existing system services or run an isolated Docker stack.
- Existing Redis + reuse mode does not start `redis-1` and passes a container-reachable `COMPOSE_REDIS_URL` to API/worker.
- Existing Postgres + reuse mode does not start `postgres-1` and passes `COMPOSE_DATABASE_URL`.
- Existing MinIO/S3 + reuse mode does not start `minio-1` and passes `COMPOSE_S3_ENDPOINT`.
- Isolated Docker mode still starts Redis/Postgres/MinIO containers and keeps current port-remap warnings.
- Reuse mode stops before Compose startup if a host endpoint is reachable from the host but not usable from containers.

System Caddy safety:

- Existing system Caddy with valid HappyTG routes is reused; `caddy-1` does not start and finalization reports system Caddy reuse.
- Existing system Caddy without HappyTG routes plus `Print Caddy snippet` does not edit files and prints the exact snippet plus validate/reload commands.
- Existing system Caddy without HappyTG routes plus `Patch Caddyfile` requires two confirmations, writes a backup, validates before reload, and only modifies a marked HappyTG block.
- Patch refusal, invalid Caddy config, failed validate, failed reload, and missing Caddyfile path all produce clear final guidance without starting a conflicting container Caddy.
- Isolated Docker mode still starts Compose Caddy and preserves existing Caddy port remap behavior.

Background cleanup:

- Windows install selecting `scheduled-task` after a previous `startup` install removes the Startup shortcut and configures only the Scheduled Task.
- Windows install selecting `startup` after a previous `scheduled-task` install deletes the Scheduled Task and creates only the Startup shortcut.
- Windows install selecting `manual` or `skip` after either previous mode removes both Scheduled Task and Startup shortcut.
- Repeated installs with merged `ownedArtifacts` clean all recorded launcher artifacts before creating the selected new one.
- Custom `HAPPYTG_STATE_DIR` without recorded ownership does not delete default global Scheduled Task or Startup shortcut.
- Default state scope can clean default HappyTG-named artifacts even if older state is incomplete.
- If cross-platform reset is implemented, add equivalent LaunchAgent/systemd-user coverage.

## Recommended Evidence To Capture

Store outputs in `.agent/tasks/<TASK_ID>/raw/`:

- `init-memory.txt`
- `git-status-before.txt`
- `install-ps1-warning-repro.txt`
- `prompt-order-analysis.txt`
- `background-artifact-reset-analysis.txt`
- `docker-post-install-warning-repro.txt`
- `docker-final-guidance-analysis.txt`
- `docker-service-strategy-analysis.txt`
- `docker-reuse-compose-config.txt`
- `system-caddy-detection.txt`
- `system-caddy-snippet.txt`
- `system-caddy-patch-safety.txt`
- `test-install-scripts.txt`
- `test-install-runtime.txt`
- `test-install-state.txt`
- `test-uninstall.txt`
- `typecheck.txt`
- `build.txt`
- `lint.txt`
- `doctor-json.txt`
- `verify.txt`
- `task-validate.txt`
- `fresh-verifier.txt`

Sanitize tokens, private Telegram IDs, private URLs, and any credentials in `.env`.

## Verification Requirements

At minimum run and record:

```powershell
pnpm --filter @happytg/bootstrap exec tsx --test src/install.scripts.test.ts
pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "pnpm|approve-builds|ignored build scripts|Docker|background|Scheduled Task|Startup|launch mode"
pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Docker|reuse|Redis|Postgres|MinIO|Caddy|snippet|patch"
pnpm --filter @happytg/bootstrap exec tsx --test src/cli.test.ts --test-name-pattern "Docker|launch|finalization|next steps|warnings"
pnpm --filter @happytg/bootstrap exec tsx --test src/infra-config.test.ts
pnpm --filter @happytg/bootstrap exec tsx --test src/install.state.test.ts
pnpm --filter @happytg/bootstrap exec tsx --test src/uninstall.test.ts --test-name-pattern "background|owned|Scheduled Task|Startup|custom"
pnpm --filter @happytg/bootstrap run typecheck
pnpm --filter @happytg/bootstrap run build
pnpm --filter @happytg/bootstrap run lint
pnpm happytg task validate --repo . --task HTG-2026-05-01-installer-bootstrap-warning-background-reset
```

If shared installer control flow, docs, CLI output, or post-check behavior changes, also run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg doctor --json
pnpm happytg verify
```

For Windows runtime proof, use dependency-injected command runners where possible. Do not create or delete real user Scheduled Tasks or Startup shortcuts in automated tests unless the proof environment is explicitly disposable and the evidence says so.

For system Caddy runtime proof, do not patch the real host Caddyfile in automated tests. Use temp files and fake command runners for backup/validate/reload behavior. Any live Caddy validation/reload proof must be manually approved in the task evidence and must not expose secrets.

## Completion Criteria

Do not mark complete until the proof bundle demonstrates:

1. The public PowerShell install path no longer emits `WARNING:` for a successful shared bootstrap ignored-build-script report.
2. Real pnpm build-script failures are still surfaced by the repo-local installer path.
3. Docker launch mode no longer makes the background menu look like Docker service startup.
4. The host daemon's required host-side role is explicit in Docker mode.
5. Repeated installs leave only the newly selected HappyTG background launcher active.
6. Selecting `Manual` or `Skip` removes old HappyTG autostart artifacts.
7. Custom state scope safety remains intact.
8. Docker-mode completion output has a clear "already running / required next action / optional inspection commands" story.
9. Docker-mode success does not ask the operator to run `pnpm dev` for the control-plane stack.
10. Docker-mode warnings are either removed, demoted, or rewritten so each warning has a concrete cause and next action.
11. Docker mode has an explicit service strategy choice.
12. Reuse mode does not start duplicate containers for services selected for reuse.
13. Existing system Caddy is reused when HappyTG routes already exist and validate.
14. Missing HappyTG Caddy routes default to printing a snippet without mutation.
15. Caddyfile patching requires double confirmation, backup, validate-before-reload, and rollback guidance.
16. Required verification is green.
17. A fresh verifier pass confirms the repair without editing production code.
