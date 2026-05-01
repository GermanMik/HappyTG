# Evidence

Task: HTG-2026-05-01-installer-bootstrap-warning-background-reset
Phase: evidence
Branch: codex/installer-bootstrap-warning-background-reset

## Startup Discipline

- EchoVault project context and targeted searches were retrieved before production edits. Raw output: `raw/init-memory.txt`.
- Branch was created/switched before production edits. Raw status: `raw/git-status-before.txt`.
- Scope was frozen in `spec.md` before implementation.
- Builder role: Codex implementation pass.
- Fresh verifier role: pending separate read-only pass.

## Implementation Summary

- Demoted the successful shared-bootstrap ignored-build-script path from a PowerShell `Write-Warning` to a short informational line in `scripts/install/install.ps1`.
- Mirrored the same success-path wording in `scripts/install/install.sh` so the temporary bootstrap path does not recommend `pnpm approve-builds` after the marker proves the required `tsx`/`esbuild` path.
- Reordered interactive install so `Launch Mode` is selected before host-daemon background startup. The background screen is now titled `Host Daemon Startup` and receives launch-mode context.
- Added install-time background artifact reset through `resetBackgroundModeArtifacts`, reusing safe ownership rules: default scope can clean default HappyTG launchers; custom state scopes only clean recorded global ownership.
- Changed install state writes so current background ownership replaces stale merged launcher ownership after reset.
- Added Docker service strategy planning in `packages/bootstrap/src/install/docker-services.ts`.
- Reuse mode starts only app/observability Compose services with `--no-deps`, skips reused Redis/Postgres/MinIO/Caddy service targets, and passes container-reachable `COMPOSE_REDIS_URL`, `COMPOSE_DATABASE_URL`, and `COMPOSE_S3_ENDPOINT`.
- Added system Caddy detection, snippet generation, and guarded patch flow with backup, managed block replacement, validate-before-reload, and rollback guidance.
- Reworked Docker launch finalization so a successful Compose start is `done/auto`, not a pending next step, and Docker day-2 commands are shown.
- Added CLI flags for explicit non-interactive Docker service/Caddy choices and documented the 0.4.8 release.

## Explicit Investigation Answers

1. `install.ps1` emitted a PowerShell `WARNING:` because `Invoke-SharedInstallerBootstrapPreflight` treated any ignored-build-script text from the temporary `pnpm dlx tsx --eval` output as warning-worthy even after the command exited 0 and printed `HTG_INSTALLER_BOOTSTRAP_OK:1`.
2. Demoting that message does not hide the real failure path: a non-zero `pnpm dlx tsx` exit and a missing marker are still hard failures, and repo-local `runPnpmInstall` still assesses ignored scripts and the critical `tsx`/`esbuild` path through the toolchain check.
3. `runHappyTGInstall` in `packages/bootstrap/src/install/index.ts` decides prompt order. The launch-mode step now runs before the background step, and the background renderer receives `launchMode`.
4. Docker mode starts the packaged control-plane stack only. The host daemon still runs on Windows/macOS/Linux for local repository, Codex, and host-operation access, so the UI now names that choice `Host Daemon Startup`.
5. Windows stale artifacts are the Scheduled Task `HappyTG Host Daemon`, the Startup shortcut `HappyTG Host Daemon.cmd`, and launcher scripts under HappyTG local state.
6. macOS/Linux parity cleanup covers LaunchAgent plist and systemd-user unit artifacts plus local launcher scripts under state.
7. Cleanup is safe by combining recorded `ownedArtifacts` with default-state-only cleanup of default HappyTG global names. A custom `HAPPYTG_STATE_DIR` without recorded ownership does not query or delete default global launchers.
8. Selecting `manual` or `skip` now runs reset first and creates no new autostart launcher. Finalization states the host daemon must be started manually when host operations are needed.
9. Docker success guidance is now classified as completed Compose startup, manual host-daemon/pairing/menu actions, reusable service state, or blockers. Expected host-daemon separation is no longer a generic warning.
10. Successful Docker finalization now includes `Docker Compose stack: started.`
11. Docker-mode success no longer tells the operator to run `pnpm dev` for the control-plane stack after Compose started. `pnpm dev:daemon` appears only for the host daemon.
12. Final guidance separates Compose stack, host daemon, Telegram pairing/menu/public URL, Caddy strategy, and Docker inspect/log/restart/stop commands.
13. Existing port-conflict handling lived in `resolvePortConflictsBeforePostChecks`, which remapped occupied Docker infra ports. Docker service planning now runs first and passes skip IDs for reused services so remap does not create duplicate infra/Caddy containers.
14. The chosen Compose mechanism is service-targeted `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d --no-deps api worker bot miniapp prometheus grafana` plus `caddy` only when Compose Caddy is selected. `--no-deps` avoids invalid `depends_on` startup of skipped infra services.
15. Reused Redis receives `COMPOSE_REDIS_URL` from `REDIS_URL`, with loopback translated to `redis://host.docker.internal:<port>`; Linux also gets a generated extra_hosts override for `host-gateway`.
16. Reused Postgres and MinIO/S3 are represented as `COMPOSE_DATABASE_URL` and `COMPOSE_S3_ENDPOINT` with the same loopback-to-host translation; remote non-loopback endpoints are preserved.
17. System Caddy detection checks for a `caddy` executable and candidate Caddyfile paths from explicit option, env, repo Caddyfile, and common platform paths without mutating files.
18. Existing HappyTG Caddy routes are detected by managed markers and route text for the domain, `/miniapp`, `/telegram/webhook`, Mini App API allowlist, and upstreams, then validated with `caddy validate`.
19. The host-run Caddy snippet routes `/telegram/webhook` to the bot host port, Mini App public API allowlisted paths to the API host port, and `/miniapp`/static assets to the Mini App host port. Snapshot: `raw/system-caddy-snippet.txt`.
20. Patch confirmation copy names the operator-owned reverse proxy risk, target Caddyfile, backup path, managed block, validate command, reload command, and rollback command. Patching proceeds only after the second confirmation.

## Raw Evidence

- Bootstrap warning reproduction and fix: `raw/test-install-scripts.txt`.
- Prompt order and Docker/background tests: `raw/test-install-runtime.txt`.
- Docker reuse command/env behavior: `raw/test-install-runtime-docker-reuse.txt`.
- CLI flags and finalization parsing: `raw/test-cli.txt`.
- Caddy detection/snippet/patch tests: `raw/test-infra-config.txt`.
- Background state/reset tests: `raw/test-install-state.txt`.
- Uninstall ownership parity tests: `raw/test-uninstall.txt`.
- Full bootstrap package tests: `raw/test-unit.txt`.
- Typecheck/build/lint: `raw/typecheck.txt`, `raw/build.txt`, `raw/lint.txt`.
- Root verification: `raw/root-lint.txt`, `raw/root-typecheck.txt`, `raw/root-test.txt`, `raw/root-build.txt`.
- Release metadata check: `raw/release-check.txt`.
- Doctor/verify environment proof: `raw/doctor-json.txt`, `raw/verify.txt`.

## Verification Summary

- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.scripts.test.ts`: passed, 5 tests.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "pnpm|approve-builds|ignored build scripts|Docker|background|Scheduled Task|Startup|launch mode"`: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Docker|reuse|Redis|Postgres|MinIO|Caddy|snippet|patch"`: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/cli.test.ts --test-name-pattern "Docker|launch|finalization|next steps|warnings"`: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/infra-config.test.ts`: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.state.test.ts`: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/uninstall.test.ts --test-name-pattern "background|owned|Scheduled Task|Startup|custom"`: passed.
- `pnpm --filter @happytg/bootstrap run typecheck`: passed.
- `pnpm --filter @happytg/bootstrap run build`: passed.
- `pnpm --filter @happytg/bootstrap run lint`: passed.
- `pnpm --filter @happytg/bootstrap test`: passed, 139 tests.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed.
- `pnpm build`: passed.
- `pnpm release:check --version 0.4.8`: passed.
- `pnpm happytg doctor --json`: completed with environment warnings unrelated to this repair: Codex websocket fallback to HTTP, public Caddy Mini App route identity mismatch, and already-running local services.
- `pnpm happytg verify`: completed with the same environment warnings and no install-code failure.

## Runtime Safety Notes

- Automated tests use dependency-injected command runners and temp files. They do not create/delete real Windows Scheduled Tasks, Startup shortcuts, Docker Desktop containers, or system Caddyfiles.
- No live system Caddy patch/reload was performed.
- Docker reuse endpoint handling is proven by command/env tests and static loopback translation. Live container-network probes were intentionally not run against operator infrastructure.

## Fresh Verifier Pass 1

Verifier: `019de30c-a663-7563-8f8d-78acdb0bb8ff`

Findings:

- P1: repo starter `infra/caddy/Caddyfile` was treated as active system Caddy.
- P1: system Caddy snippets could be generated before final port remaps.
- P2: Caddy reuse detection did not prove the full route surface.

Minimal fixes applied:

- Removed the repo starter Caddyfile from implicit system Caddy candidate paths. Explicit `--caddyfile` and env-provided paths remain honored.
- Tightened `hasHappyTGRoutes` to require the Mini App route, static route, webhook, allowed Mini App API routes, approval resolve route, generic API deny, forwarded prefix, domain marker, and at least three reverse proxies.
- Split Docker service selection from final Docker service plan construction. The installer now chooses reuse/isolated strategy before port preflight, skips reuse-service port remaps based on that choice, then builds the final Caddy snippet/patch/reuse plan after `.env` port overrides are applied.
- Added regression tests for the repo starter false-positive, incomplete Caddy route reuse, and Caddy snippet generation after Mini App port remap.

## Fresh Verifier Pass 2

Verifier: `019de31b-207a-74e0-b7da-7ed4a9cf1f2d`

Verdict: no blocking findings.

Verifier confirmed:

- Repo starter `infra/caddy/Caddyfile` is no longer treated as active system Caddy by default.
- System Caddy snippet/patch planning now runs after port preflight remaps and uses final `repoEnv`.
- Existing system Caddy reuse now requires the fuller HappyTG public route surface.
- Bootstrap warning demotion, background reset safety, Docker reuse command/env shape, and release `0.4.8` metadata passed targeted checks.
