# Project Memory

Project memory is the safe, repo-local context that should travel with HappyTG through normal Git history. It is meant for durable project decisions, operational notes, troubleshooting patterns, and architecture context that future agents or maintainers should read before changing the repository.

Project memory is not raw Codex native memory, EchoVault databases, indexes, caches, logs, or any machine-local private store.

## Files

- `AGENTS.md`: agent rules, workflow expectations, and durable project instructions.
- `docs/memory/decisions.md`: important project decisions and their rationale.
- `docs/memory/troubleshooting.md`: recurring issues, diagnostics, and known local workflow fixes.
- `docs/memory/architecture.md`: compact architecture notes that help future code navigation.
- `graphify-out/GRAPH_REPORT.md`: human-readable Graphify report when present.
- `graphify-out/graph.json`: deterministic Graphify graph when present.

Do not store secrets, API keys, tokens, private endpoints, credentials, or sensitive personal data in these files.

## When To Update

Update `docs/memory/decisions.md` after meaningful technical decisions. Update `docs/memory/troubleshooting.md` after recurring bugs or non-obvious local fixes. Update `docs/memory/architecture.md` when a stable architecture finding should guide future work.

## Git Hooks

Install the repo-local hooks once after clone:

```powershell
.\scripts\install-git-hooks.ps1
```

After `git pull` or checkout, the hooks run `scripts/after-pull-memory-sync.ps1` and check whether project memory files changed. When changes are found, the hook prints the changed files and, if the local `memory` CLI is available, saves a small EchoVault pointer record with only the repo name, commit hash, and file list.
