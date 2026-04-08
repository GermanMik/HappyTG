# Local Development

## Daily Workflow

1. Pull latest main.
2. Create a branch with `codex/` prefix.
3. For non-trivial work, initialize a task bundle under `.agent/tasks/<TASK_ID>/`.
4. Freeze spec before editing code.
5. Build, collect evidence, run a fresh verifier pass, and only then finalize.

## Branch and Worktree Strategy

- One branch per focused task.
- Use separate worktrees for independent proof-loop tasks or verifier runs.
- Keep verifier sessions clean and independent from builder context.

## Quick Mode vs Proof Loop

- Quick mode: small, low-risk, easily verified tasks.
- Proof loop: architecture changes, risky mutations, multi-file behavior changes, security-sensitive work, bootstrap changes.

## Verification

Standard verification commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg verify
```

Store command output in task bundle raw artifacts for proof-loop tasks.

Useful repo-local task commands:

```bash
pnpm happytg task init --repo . --task HTG-0001 --session ses_manual --workspace ws_manual --title "Proof task" --criterion "criterion one"
pnpm happytg task status --repo . --task HTG-0001
pnpm happytg task validate --repo . --task HTG-0001
```
