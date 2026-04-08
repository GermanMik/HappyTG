# Bootstrap and Doctor

## Commands

- guided first start: `pnpm happytg setup`
- repo-local: `pnpm happytg doctor`
- repo-local JSON diagnostics: `pnpm happytg doctor --json`
- repo-local: `pnpm happytg setup`
- repo-local: `pnpm happytg repair`
- repo-local: `pnpm happytg verify`
- repo-local: `pnpm happytg status`
- repo-local: `pnpm happytg config init`
- repo-local: `pnpm happytg env snapshot`
- installed binary: `happytg ...` with the same subcommands

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

`pnpm happytg setup` is the compact onboarding path.

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

## State Files

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
