# Task Spec

- Task ID: HTG-2026-05-11-project-memory-sync
- Title: Project memory sync hooks
- Owner: HappyTG
- Mode: proof
- Status: frozen
- Frozen by: codex
- Frozen at: 2026-05-11T00:00:00+03:00

## Problem

Project-level memory should travel with the repository after `git pull` on another machine without committing raw Codex native memory, EchoVault databases, indexes, caches, logs, or secrets. The repository needs safe memory files, ignore rules for generated local state, and opt-in Git hooks that detect memory file changes after merge or checkout.

## Acceptance Criteria

1. `docs/memory/` exists with `README.md`, `decisions.md`, `troubleshooting.md`, and `architecture.md`.
2. `AGENTS.md` has a short `Project Memory` section that tells agents which project memory files to read and what not to store.
3. `.gitignore` ignores local Graphify residue, database/index/cache/log/lock files, and still allows `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` to be committed.
4. `scripts/install-git-hooks.ps1` verifies the Git repo, creates `.githooks/`, configures `core.hooksPath`, and prints a clear success message on Windows PowerShell.
5. `scripts/after-pull-memory-sync.ps1` supports `-Mode`, `-OldRef`, and `-NewRef`; detects project memory changes for merge, checkout, and manual runs; prints changed memory files only when found; deduplicates EchoVault saves through `.git/project-memory-sync-state.json`; and does not fail when `memory` CLI is unavailable.
6. `.githooks/post-merge` and `.githooks/post-checkout` are shell wrappers that call the PowerShell sync script through `pwsh` or `powershell.exe` under Git for Windows.
7. Documentation explains project memory, files to update after important decisions, one-time hook installation, and automatic checks after `git pull`.

## Constraints

- Do not commit raw Codex native memory.
- Do not commit EchoVault DB/index/cache.
- Do not store secrets, API keys, tokens, private endpoints, or private credentials.
- Preserve existing HappyTG architecture and proof-loop conventions.
- Keep changes small and limited to docs, ignore rules, scripts, hooks, and task evidence.
- Do not run heavy lint/test/build checks for this docs/tooling task unless a script check requires it.
- Do not make a git commit.

## Verification Plan

- Run `git status --short`.
- Run `.\scripts\install-git-hooks.ps1`.
- Run `.\scripts\after-pull-memory-sync.ps1 -Mode manual`.
- Inspect script behavior and final diff for scope, secret safety, and Windows/Git hook compatibility.
