# Problems

- `pnpm release:check` without `--version` failed as designed because the script requires an explicit version. The versioned command `pnpm release:check -- --version 0.4.6` passed.
- `pnpm happytg doctor` and `pnpm happytg verify` exit 0 but report workstation warnings: Codex websocket fallback, public Caddy `/miniapp` identity mismatch, and in the doctor run occupied host ports from another local Docker stack. These are environment warnings, not release blockers for the Docker/installer code changes.
- During verification, an external/parallel checkout briefly stashed the dirty Docker/installer worktree as `stash@{0}` with message `pre-codex-desktop-task-existing-worktree`. The worktree was restored on `codex/installer-docker-caddy-port80-repair`; the unrelated Codex Desktop proof artifact remains untracked and out of scope.
