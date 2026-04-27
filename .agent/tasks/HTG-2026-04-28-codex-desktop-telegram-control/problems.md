# Problems

- Desktop Resume is unsupported in production for this task: no stable Desktop/API-safe control handle was proven.
- Desktop Stop is unsupported in production for this task: no stable session-to-process/control handle was proven.
- New Desktop Task is unsupported in production for this task: no stable Desktop task creation contract was proven.
- `pnpm happytg doctor` reports FAIL in this local environment because `.env`/`TELEGRAM_BOT_TOKEN` are missing and the Mini App port is occupied by an unrelated Contacts container.
- `pnpm happytg verify` reports FAIL for the same environment blockers.
- Draft PR #40 exists and GitHub `verify` passed, but release merge is still blocked until the required local verification can pass with a valid Telegram bot configuration and a non-conflicting Mini App port. I did not create fake secrets, commit `.env`, stop unrelated services, or bypass this blocker.
