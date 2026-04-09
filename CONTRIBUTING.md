# Contributing

## Scope

HappyTG is an event-driven control plane for remote AI coding workflows. Contributions should preserve four invariants:

1. Telegram is a render layer, not the source of truth.
2. Mutating execution is serialized and policy/approval guarded.
3. Verification is independent from build.
4. Non-trivial work produces repo-local proof artifacts.

## Development Workflow

1. Read [Agent Guidance](./AGENTS.md).
2. Read [Local Development](./docs/local-development.md).
3. For non-trivial tasks, initialize a task bundle under `.agent/tasks/<TASK_ID>/`.
4. Freeze spec before build.
5. Record evidence and run a fresh verifier pass before claiming completion.

## Pull Request Expectations

- Include a short problem statement.
- Link task bundle paths if the change is non-trivial.
- List verification commands executed.
- Highlight policy, approval, security, or compatibility impacts.
- Do not merge if verification and implementation were performed by the same role in proof-loop mode.

## Coding Rules

- Prefer explicit state machines over hidden implicit flow.
- Model all significant transitions as typed events.
- Keep UI surfaces thin; domain logic belongs in shared engines.
- Use deterministic manifests and rule engines for bootstrap/install flows.
- Never add an LLM-generated arbitrary shell installer path.

## Commit Hygiene

- Keep commits focused.
- Avoid mixing runtime, protocol, and UI churn unless the vertical slice requires it.
- Preserve backward-compatible event schemas unless explicitly versioned.
