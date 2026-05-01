# HTG-2026-05-01 Installer Bootstrap Warning, Docker Reuse, And Caddy Safety

Phase: complete
Verification: fresh verifier pass 2 accepted; required checks recorded

## Frozen Scope

Repair the HappyTG installer so successful shared bootstrap ignored-build-script output is not presented as a scary PowerShell warning, Docker launch mode clearly separates the Compose control-plane stack from the host daemon, repeated installs reset HappyTG-owned background launchers safely, Docker final guidance is explicit, and Docker mode gains an explicit reuse-vs-isolated service strategy with conservative system Caddy handling.

## In Scope

- Demote or suppress successful shared-bootstrap ignored-build-script messaging in `scripts/install/install.ps1` while preserving hard failures for missing bootstrap markers and failed `pnpm dlx tsx` probes.
- Preserve repo-local `pnpm install` ignored-build-script assessment and actionable failure/warning guidance.
- Ensure interactive install chooses or renders launch mode before host-daemon background startup context, with Docker-specific host daemon wording.
- Reset stale HappyTG-owned background launchers before applying the selected background mode, including Windows Scheduled Task and Startup shortcut, while preserving custom `HAPPYTG_STATE_DIR` safety.
- Make Docker-mode final output classify already-started Compose, required host-daemon actions, optional Docker day-2 commands, Telegram pairing/menu guidance, warnings, and blockers consistently across TUI/text/JSON surfaces.
- Add an explicit Docker service strategy decision for interactive Docker installs: reuse existing system services or run an isolated Docker stack.
- In reuse mode, avoid starting duplicate Compose services for reused Redis/Postgres/MinIO/Caddy and pass container-reachable endpoints into app containers.
- Detect system Caddy and existing HappyTG routes without mutating operator files by default; print snippets by default; patch only with double confirmation, backup, validation before reload, and rollback guidance.
- Add targeted regression tests and record verification evidence.

## Out Of Scope

- Containerizing the host daemon.
- Rewriting installer architecture or Docker topology beyond the smallest safe Compose command/service-selection mechanism.
- Mutating the real host Scheduled Task, Startup folder, Docker Desktop, or system Caddyfile in automated tests.
- Weakening pnpm build-script policy or silently approving blocked build scripts.
- Changing Telegram/internal transport architecture or host operation queue semantics.

## Acceptance Criteria

- Successful shared installer bootstrap with ignored-build-script text and a valid marker does not emit `WARNING:`.
- Real bootstrap failure and missing marker still fail.
- Repo-local ignored-build-script handling still surfaces real critical toolchain risk.
- Docker mode background UX clearly names host daemon startup and does not imply Docker service startup.
- Repeated installs leave only the newly selected HappyTG background launcher active; `manual` and `skip` remove old autostart artifacts.
- Custom state scopes do not delete unowned default global launcher artifacts.
- Docker-mode success output does not tell the operator to run `pnpm dev` for the Compose control-plane stack after Compose already started.
- Docker final output includes inspect/log/restart/stop commands and a clear status for Compose, host daemon, pairing, Mini App URL, Caddy, warnings, and blockers.
- Docker reuse mode does not start duplicate containers for selected reused services.
- System Caddy reuse/snippet/patch flows are safe and covered by injected-command tests.
- Required focused tests, typecheck/build/lint, task validation, and a fresh verifier pass are recorded.
