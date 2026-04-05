# Bootstrap and Doctor

## Commands

- `happytg doctor`
- `happytg setup`
- `happytg repair`
- `happytg verify`
- `happytg status`
- `happytg config init`
- `happytg env snapshot`

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
