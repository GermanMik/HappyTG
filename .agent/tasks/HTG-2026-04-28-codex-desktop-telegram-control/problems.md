# Problems

- Desktop Resume is unsupported in production for this task: no stable Desktop/API-safe control handle was proven.
- Desktop Stop is unsupported in production for this task: no stable session-to-process/control handle was proven.
- New Desktop Task is unsupported in production for this task: no stable Desktop task creation contract was proven.
- `pnpm happytg doctor` now exits 0 with WARN after using the local ignored `.env` and non-conflicting port overrides. Remaining warning: Codex websocket fallback and public Caddy Mini App route identity.
- `pnpm happytg verify` now exits 0 with WARN after using the local ignored `.env` and non-conflicting port overrides. Remaining warning: Codex smoke timeout and public Caddy Mini App route identity.
- PR #40 is still a draft before release transition; it must be marked ready immediately before merge after the final proof commit is pushed and CI remains green.
- I did not create fake secrets, commit `.env`, stop unrelated services, force a non-green merge, or bypass branch protection.
