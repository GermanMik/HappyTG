# HappyTG Agent Guidance

This repository is optimized for Codex and Cursor workflows. Follow these rules for any substantial task.

## Runtime Assumptions

- Primary runtime: Codex CLI.
- Primary task proof path: `.agent/tasks/<TASK_ID>/`.
- Primary verification model: fresh verifier pass after build or fix.
- Primary UI surfaces: Telegram Bot for control and approvals, Mini App for deep inspection.

## Canonical Proof Bundle

For any non-trivial task, create:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
    build.txt
    test-unit.txt
    test-integration.txt
    lint.txt
```

`spec.md` is the frozen scope contract. Do not start build before spec freeze.

## Proof Loop

Required phases:

1. `init`
2. `freeze/spec`
3. `build`
4. `evidence`
5. `fresh verify`
6. `minimal fix`
7. `fresh verify`
8. `complete`

Rules:

- builder and verifier must be separate roles;
- verifier does not edit production code;
- fixer only changes the minimum required scope;
- completion requires evidence that acceptance criteria are satisfied.

## Preferred Agent Roles

- `task-spec-freezer`
- `task-builder`
- `task-verifier`
- `task-fixer`

Use the templates in `.codex/agents/`.

## Verification Commands

Standard repo commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg doctor
pnpm happytg verify
```

Task-local verification should be recorded in `.agent/tasks/<TASK_ID>/raw/`.

## External Discipline Sources

For substantial tasks, agents must use these sources as discipline and engineering guides:

- [repo-task-proof-loop](https://github.com/DenisSergeevitch/repo-task-proof-loop)
- [Quick Start / verify docs](https://mintlify.wiki/DenisSergeevitch/repo-task-proof-loop/quickstart)
- [verify command reference](https://mintlify.wiki/DenisSergeevitch/repo-task-proof-loop/reference/commands/verify)
- [Вскрываем исходники Claude Code](https://teletype.in/@ndmscw/claude_code_sources)

Use them to reinforce proof-loop rigor, fresh verification, bounded parallel read-only exploration, serialized writes, fast-path startup thinking, and separation of startup orchestration from core logic.

These are discipline sources, not substitutes for repository evidence. Final decisions and fixes must stay grounded in the real code, runtime behavior, and documentation of the current repository.

## Architecture Invariants

- Telegram is not the internal transport for agent events.
- Mutating host operations run through a strict serialized queue.
- Policy evaluation precedes approval evaluation.
- Higher-level policy cannot be weakened by lower-level overrides.
- Heavy runtime initialization is lazy and cache-aware.
- Hooks are platform primitives, not app-specific glue.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Project Memory

- At session start, read `docs/memory/README.md` when it exists.
- Read `docs/memory/decisions.md`, `docs/memory/troubleshooting.md`, and `docs/memory/architecture.md` when they exist and are relevant to the task.
- Read `graphify-out/GRAPH_REPORT.md` when it exists and the task involves architecture, dependencies, module relationships, or broad codebase navigation.
- Never store secrets, API keys, tokens, private endpoints, credentials, or sensitive personal data in project memory.
- EchoVault and Codex global memory are local agent memory layers and are not part of this repository.

## Project Codex Instructions — layered memory

### Language policy

- Отвечать пользователю на русском.
- Уточняющие вопросы, progress updates, summaries и финальные отчёты писать на русском.
- Commands, paths, filenames, config keys, code identifiers, package names и tool names оставлять в original form.

### Project summary

HappyTG is a Telegram-first, Codex-first, self-hosted control plane for remotely operating AI coding sessions on a home machine or server. Telegram is a render/approval surface, not the execution core or source of truth.

### Existing project approach

Derived from:
- `AGENTS.md`
- `README.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `ROADMAP.md`

Rules:
- Preserve the split execution model: render layers, control plane, execution plane and durable state.
- Preserve the architecture invariants listed above.
- Mutating host operations must remain serialized, policy-checked and approval-guarded.
- For non-trivial work, follow the existing proof-loop and `.agent/tasks/<TASK_ID>/` evidence discipline.

### Stack

- pnpm + Turbo monorepo.
- TypeScript.
- Apps: `apps/api`, `apps/bot`, `apps/miniapp`, `apps/worker`, `apps/host-daemon`.
- Packages: approval, policy, protocol, runtime adapters, session engine, hooks, shared tooling.
- Telegram Bot and Mini App surfaces.
- Postgres/local runtime state where configured by the project.

### Package manager

- `pnpm@10.0.0` via `packageManager` and `pnpm-lock.yaml`.

### Important commands

Install:
- `pnpm install`

Dev:
- `pnpm dev`
- `pnpm dev:api`
- `pnpm dev:bot`
- `pnpm dev:miniapp`
- `pnpm dev:worker`
- `pnpm dev:daemon`

Test:
- `pnpm test`
- `pnpm happytg doctor`
- `pnpm happytg verify`

Lint:
- `pnpm lint`

Build:
- `pnpm build`

Docker:
- Inspect `infra/` before running Docker commands.

### Repository layout

- `apps/`: runtime applications.
- `packages/`: shared engines, protocols, adapters and utilities.
- `docs/`: engineering blueprint and operational documentation.
- `infra/`: deployment and local infrastructure examples.
- `.agent/tasks/`: canonical proof bundles.
- `.codex/agents/`: proof-loop agent templates.

### Local LLM notes

- LM Studio is the local LLM runtime.
- Common endpoint: `http://localhost:1234/v1`.
- Do not add Ollama configuration unless explicitly requested.
- Do not use Ollama as fallback.
- If HappyTG integrates an OpenAI-compatible local endpoint, make the base URL configurable and preserve existing project config contracts.
- Never commit secrets, bot tokens, API keys or local-only credentials.

### Engineering rules

- Make minimal, reviewable changes.
- Preserve control-plane state as source of truth.
- Do not turn Telegram into the internal transport for agent events.
- Do not weaken policy/approval invariants through lower-level overrides.
- Do not introduce unrelated formatting changes.
- Run the smallest relevant validation and store raw proof in `.agent/tasks/<TASK_ID>/raw/` for substantial work.

### Memory rules for this project

- Save durable decisions, bugs, architecture findings and recurring workarounds to EchoVault when `memory` is available.
- Use tags: `HappyTG`, `architecture`, `bugfix`, `telegram`, `miniapp`, `mcp`, `llm`, `lm-studio`, `backend`, `frontend`, `deployment`.
- Do not save temporary logs, secrets, credentials, API keys, bot tokens or personal data.
- If a new durable project rule is discovered, add it to `AGENTS.md` with its source.

### Graphify

- If `graphify-out/GRAPH_REPORT.md` exists, read it before broad architecture or dependency work.
- `graphify` is optional. Do not run heavy graph generation automatically unless the task needs architecture/dependency understanding.
- Do not treat Graphify as a replacement for reading source files.

### Done criteria

- Relevant files changed.
- Relevant tests/lint/build run where possible, or the reason for not running them is stated.
- Proof-loop artifacts are updated for non-trivial work.
- Important decisions saved to EchoVault if useful.
- `AGENTS.md` updated if a new durable project rule was discovered.
