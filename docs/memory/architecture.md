# Project Memory Architecture

HappyTG uses layered memory:

- repo-local project memory: safe files committed with the project;
- Graphify outputs: committed `GRAPH_REPORT.md` and `graph.json` only;
- EchoVault: local durable agent memory outside the repository;
- Codex global memory: local personal/workflow memory outside the repository.

Git hooks are notification and indexing helpers only. They do not make Telegram an internal transport for agent events, do not change runtime state, and do not copy project memory contents into EchoVault.
