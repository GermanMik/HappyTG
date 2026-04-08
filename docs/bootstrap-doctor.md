# Bootstrap and Doctor

## Commands

- repo-local: `pnpm happytg doctor`
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
