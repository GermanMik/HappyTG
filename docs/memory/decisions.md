# Project Memory Decisions

## Repo-local project memory

- Date: 2026-05-11
- Decision: HappyTG project memory lives in safe Git-tracked files: `AGENTS.md`, `docs/memory/*.md`, `graphify-out/GRAPH_REPORT.md`, and `graphify-out/graph.json`.
- Rationale: These files can travel across machines through normal `git pull` without exposing raw Codex native memory or EchoVault internals.
- Impact: Future agents should read this memory layer at session start, but must keep secrets, local databases, indexes, caches, logs, and machine-private memory outside the repository.
