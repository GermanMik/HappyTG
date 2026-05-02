# Local Update And Uninstall User Flow Prompt

Use this prompt when HappyTG needs a simpler user-facing update/uninstall path for local users without weakening the existing installer, Docker, self-hosting, or daemon cleanup safety model.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Create or switch to a dedicated branch before changing files:

```powershell
git switch -c codex/local-update-uninstall-user-flow
```

If the branch already exists, switch to it without discarding user work. Do not use `git reset --hard`, `git checkout --`, or destructive cleanup unless the user explicitly asks.

## Mandatory Startup

1. Retrieve project memory:
   - `memory context --project`
   - `memory search "HappyTG local update uninstall installer current Docker self-hosting"`
   - fetch details for memories with `Details: available`.
2. Inspect current docs and bootstrap commands before proposing changes:
   - `README.md`
   - `docs/quickstart.md`
   - `docs/installation.md`
   - `docs/bootstrap-doctor.md`
   - `docs/troubleshooting.md`
   - `docs/self-hosting.md`
   - `docs/operations/runbook.md`
   - `packages/bootstrap/src/cli.ts`
   - `packages/bootstrap/src/install/repo.ts`
   - `packages/bootstrap/src/uninstall/index.ts`
3. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` and freeze `spec.md` before production edits.
4. Keep builder and verifier responsibilities separate. The verifier must not edit production files.

Recommended task id: `HTG-YYYY-MM-DD-local-update-uninstall-user-flow`.

## Goal

Make the local update and uninstall story obvious for a non-expert user while preserving HappyTG's existing deployment choices.

The final user-facing guidance must answer:

1. How do I update an existing local checkout after GitHub changed?
2. How do I update when I originally used the one-line installer?
3. How do I update when I run local `pnpm dev`?
4. How do I update when I run Docker Compose isolated mode?
5. How do I update when Docker reuses system Redis/Postgres/MinIO/Caddy?
6. How do I update a self-hosted control plane safely?
7. How do I remove only local HappyTG bootstrap/daemon artifacts?
8. What does uninstall intentionally keep?
9. How do I stop Docker services or remove volumes if I explicitly want that?
10. What proof should I collect before declaring the local update or uninstall successful?

## Critical Review From 10 Independent Roles

Apply these role reviews before editing. Convert each concern into an explicit requirement, test, or documentation note.

| Role | Concern | Requirement |
| --- | --- | --- |
| New Windows user | "I need one command and I do not know whether I installed through PowerShell or cloned manually." | Start with `pnpm happytg install` for repo-present users and the one-line PowerShell shim for fresh bootstrap. Show a short manual fallback. |
| Local developer | "I want the fast path and do not want installer screens every time." | Document `git pull --ff-only`, `pnpm install`, `pnpm happytg doctor`, and `pnpm happytg verify` as the lightweight path for a clean checkout. |
| Docker operator | "Updating code is not enough; containers/images need rebuild." | Include `docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d` and `ps/logs` verification. |
| System-service operator | "I reuse Redis/Postgres/MinIO/Caddy and must not start duplicate infra." | Preserve `--docker-services reuse` guidance and state that reused services stay operator-owned. |
| Execution-host owner | "I only want to remove the daemon/bootstrap state from this host." | Point to `pnpm happytg uninstall` and state it keeps checkout, `.env`, Docker services/volumes, and remote control-plane data. |
| Data safety reviewer | "Users may assume uninstall deletes everything or backups are optional." | Separate local cleanup, Docker stop, Docker volume deletion, and repo deletion as distinct explicit actions. |
| Security reviewer | "Prompts and docs may leak tokens or suggest pasting secrets into evidence." | Instruct agents to mask tokens and avoid writing secrets to proof bundles, logs, docs, or memory. |
| Release manager | "Docs-only changes still need version, changelog, release notes, and guarded release checks if shipped." | Require `CHANGELOG.md`, `docs/releases/X.Y.Z.md`, workspace version alignment, and `pnpm release:check --version X.Y.Z` when publishing. |
| QA/verifier | "A simple update path is not done until diagnostics pass." | Record `doctor`, `verify`, and at least targeted package checks; full release path must run lint/typecheck/test/build. |
| Mobile/Telegram user | "Phone install means APK, but HappyTG may only have Telegram Mini App surfaces." | Detect Android packaging files before APK work. If no Android project exists, report APK as blocked and do not create a fake artifact. |

## Required User Guidance Shape

Prefer short sections with exact commands.

### Easiest Local Update

Use when the repo already exists on the user's machine:

```powershell
pnpm happytg install
pnpm happytg verify
```

Explain that the installer handles repo mode, `.env` merge, dependency install, setup/doctor/verify choices, and launch guidance.

### Lightweight Manual Update

Use when the checkout is clean and the user wants the shortest command path:

```powershell
git status --short
git pull --ff-only
pnpm install
pnpm happytg doctor
pnpm happytg verify
```

If local changes exist, instruct the user to commit, stash, or use the installer flow that offers dirty-worktree choices. Never tell users to discard changes by default.

### Restart After Update

For local dev:

```powershell
pnpm dev
pnpm daemon:pair
pnpm dev:daemon
```

For Docker isolated mode:

```powershell
docker compose --env-file .env -f infra/docker-compose.example.yml up --build -d
docker compose --env-file .env -f infra/docker-compose.example.yml ps
```

For Docker reuse mode:

```powershell
pnpm happytg install --launch-mode docker --docker-services reuse
```

State that reused Redis/Postgres/MinIO/Caddy are not owned by HappyTG and are not removed by uninstall.

### Local Uninstall

Use:

```powershell
pnpm happytg uninstall
```

State that it removes local daemon/bootstrap state, reports, logs, backups, default bootstrap checkout, and recorded HappyTG-owned launchers. State that it keeps the repo checkout, `.env`, Docker services/volumes, and remote control-plane data.

If the user also wants to stop packaged services:

```powershell
docker compose --env-file .env -f infra/docker-compose.example.yml down
```

If the user explicitly wants to delete Docker volumes, require a second explicit confirmation in any future CLI/automation. Documentation may mention Docker's volume removal as destructive, but do not make it part of the default uninstall.

## APK Gate

Before promising or building an APK, run:

```powershell
rg --files -g '*.gradle' -g 'gradlew*' -g 'AndroidManifest.xml' -g 'capacitor.config.*' -g '*.apk'
```

If no Android packaging surface exists, record:

- APK status: blocked
- reason: HappyTG currently ships as a Telegram Bot/Mini App/control-plane stack, not an Android APK project
- next required work: add a real Android wrapper/package such as Capacitor/TWA/native Android, signing policy, update channel, install proof on a device, and release artifact workflow

Do not rename web assets, zip files, or unrelated binaries to `.apk`.

## Documentation Scope

Update every user-facing place that would otherwise leave stale or incomplete guidance:

- `README.md`
- `docs/quickstart.md`
- `docs/installation.md`
- `docs/bootstrap-doctor.md`
- `docs/troubleshooting.md`
- `docs/self-hosting.md`
- `docs/operations/runbook.md`
- `docs/release-process.md` when release/APK expectations are involved
- `CHANGELOG.md`
- `docs/releases/X.Y.Z.md` for release branches

Keep wording consistent:

- "update" refreshes code/dependencies and then restarts the chosen runtime
- "uninstall" removes installer-owned local artifacts only
- "stop Docker" is separate from uninstall
- "delete volumes/data" is a separate destructive operator action

## Verification

Record command outputs under `.agent/tasks/<TASK_ID>/raw/`.

Minimum docs/prompt verification:

```powershell
pnpm release:check --version X.Y.Z
pnpm happytg task validate --repo . --task <TASK_ID>
```

Release verification:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm release:check --version X.Y.Z
pnpm happytg verify
```

If `pnpm happytg verify` fails because of local machine prerequisites such as missing secrets, unavailable Docker Desktop, or absent Telegram token, classify it truthfully as an environment blocker and preserve the raw output.

## Completion

Before final response:

1. Confirm branch status and diff.
2. If branch changes are needed, commit, push, open PR, merge when checks and policy allow, and delete local/remote task branches only after merge.
3. If the work is already in `main` or no branch is needed, remove the task branch/worktree without touching unrelated dirty worktrees.
4. Save EchoVault memory with what changed, why, impact, verification, release status, and APK status.
