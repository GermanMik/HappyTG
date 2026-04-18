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
