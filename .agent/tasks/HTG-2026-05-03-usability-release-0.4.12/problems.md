# Problems

## Non-Blocking Warnings

- `pnpm happytg doctor` and `pnpm happytg verify` exited 0 with WARN because Codex Responses websocket returned 403 and fell back to HTTP.
- The same commands reported already-running local HappyTG services on ports 3007, 4000, and 4100.
- Task validation reports `Phase: unknown` and `Verification: unknown`, but `Validation: ok`.

## Deferred

- No release publication state is recorded inside the branch proof before PR merge; final PR/CI/release state is reported after merge.
