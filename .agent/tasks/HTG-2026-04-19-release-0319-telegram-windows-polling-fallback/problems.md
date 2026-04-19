# Problems

- No release-blocking problems remain in the `0.3.19` candidate after the fresh local verification pass.
- `pnpm happytg doctor` and `pnpm happytg verify` still fail in the clean release worktree because that worktree intentionally has no `.env` or `TELEGRAM_BOT_TOKEN`; this is an environment prerequisite gap, not a code regression in the release candidate.
