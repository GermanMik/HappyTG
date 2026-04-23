# Bootstrap and Doctor

Use [Quickstart](./quickstart.md) for the shortest first run, [Installation](./installation.md) for the full setup path, and [Troubleshooting](./troubleshooting.md) when you are already debugging a failed start.

## Commands

| Command | Purpose | When to use it |
| --- | --- | --- |
| `pnpm happytg install` | Full one-command onboarding | You want repo sync, Telegram setup, env merge, launch-mode selection, and optional post-checks in one flow. |
| `pnpm happytg setup` | Compact guided first start | You want the shortest actionable checklist. |
| `pnpm happytg doctor` | Readiness inspection | You want the plain-text diagnostic summary. |
| `pnpm happytg doctor --json` | Full diagnostic payload | You need raw paths, classifications, and detailed stderr. |
| `pnpm happytg repair` | Deterministic repair path | You are applying allowed bootstrap fixes. |
| `pnpm happytg verify` | Post-fix verification | You want the same checks after setup or repair. |
| `pnpm happytg status` | Last known bootstrap state | You want the last persisted report summary. |
| `pnpm happytg config init` | Config plan-only path | You need deterministic config scaffolding. |
| `pnpm happytg env snapshot` | Environment snapshot | You want a stable env-oriented report. |
| `happytg ...` | Installed binary equivalent | You installed the bootstrap CLI outside the repo. |

## Task Bundle Commands

- `pnpm happytg task init --repo <path> --task <TASK_ID> --session <SESSION_ID> --workspace <WORKSPACE_ID> --title <TITLE> --criterion <TEXT>`
- `pnpm happytg task status --repo <path> --task <TASK_ID>`
- `pnpm happytg task validate --repo <path> --task <TASK_ID>`

## Principles

- detect first, install second
- explicit manifests and whitelisted installers
- dry-run plan before apply
- backup before edit
- verify after install
- idempotent runs
- persisted reports for repair
- keep the plain-text path short; detailed Codex stderr, Redis state, and port diagnostics belong in `--json`

## Guided First Start

`pnpm happytg install` is the primary onboarding path.

`pnpm happytg setup` remains the compact onboarding path after install or for an already-synced checkout.

For the local `pnpm dev` path, Docker Compose is a convenience for shared infra, not the only supported shape. If `DATABASE_URL`, `REDIS_URL`, and `S3_ENDPOINT` already point at reachable services, `setup` guidance can reuse them instead of assuming local Docker.

`pnpm happytg install` now keeps launch mode explicit:

- `local` preserves the `pnpm dev` workflow and does not start Docker;
- `docker` validates and starts the packaged Compose stack;
- `manual` prints exact commands without starting anything;
- `skip` stops after install plus any selected post-checks.

The Docker launch path never includes `apps/host-daemon`; pairing and host-daemon startup remain host-side follow-up steps.

It checks:

- `.env` presence,
- `TELEGRAM_BOT_TOKEN` presence and obvious format errors,
- Codex CLI availability and config,
- Redis state: absent, installed-but-stopped, running, or conflicting on the configured port,
- critical ports such as `3001`, `4000`, `4100`, `4200`, and `6379`.

The plain-text output stays short:

- preflight summary,
- findings,
- first-start checklist,
- JSON diagnostics hint.

Use `--json` when you need raw paths, detailed port classifications, or full Codex stderr.

## First-Run States

| State | What it means | Immediate action |
| --- | --- | --- |
| `.env missing` | Bootstrap could not find repo env configuration. | Create `.env` from `.env.example`, then rerun `pnpm happytg setup`. |
| `TELEGRAM_TOKEN_MISSING` | Bot token is empty or placeholder. | Set `TELEGRAM_BOT_TOKEN` in `.env`, then rerun setup. |
| `TELEGRAM_TOKEN_INVALID` | Bot token exists but does not match the expected format. | Fix the token value without printing it to logs. |
| `CODEX_MISSING` | Codex is not resolvable in this shell. | Verify `codex --version`, install or fix PATH, then rerun doctor. |
| `CODEX_UNAVAILABLE` | Codex was found, but `codex --version` failed in this shell. | Fix the local Codex runtime/environment, then rerun `pnpm happytg doctor --json`. |
| `SERVICES_ALREADY_RUNNING` | One or more HappyTG services already occupy the default ports. | Reuse the running stack or stop it before starting another copy. |

## State Files

- `~/.happytg/state/install-last.json`
- `~/.happytg/state/doctor-last.json`
- `~/.happytg/state/setup-last.json`
- `~/.happytg/state/repair-last.json`
- `~/.happytg/state/verify-last.json`
- `~/.happytg/backups/*`
- `~/.happytg/logs/*`

## Profiles

- `minimal`
- `recommended`
- `full`
- `custom`
