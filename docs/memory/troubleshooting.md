# Project Memory Troubleshooting

## Hooks do not run after pull

- Run `.\scripts\install-git-hooks.ps1` from the repository root.
- Confirm `git config core.hooksPath` prints `.githooks`.
- Confirm `.githooks/post-merge` and `.githooks/post-checkout` exist in the checkout.

## `memory` CLI is not available

The hooks still succeed. They print changed project memory files and skip the optional EchoVault pointer record.

## A memory update was already recorded

`scripts/after-pull-memory-sync.ps1` deduplicates EchoVault saves through `.git/project-memory-sync-state.json`. Re-running the same hook for the same commit and file list should not create another record.
