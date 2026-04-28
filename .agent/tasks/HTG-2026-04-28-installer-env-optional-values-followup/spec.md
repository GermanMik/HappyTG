# HTG-2026-04-28-installer-env-optional-values-followup

## Frozen Scope

Fix the interactive installer existing `.env` confirmation so optional Telegram values are visible before the Telegram form even when `.env` has no `TELEGRAM_BOT_TOKEN`.

## Acceptance

- Existing `.env` values such as `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_HOME_CHANNEL`, or `TELEGRAM_BOT_USERNAME` trigger the confirmation screen.
- Reuse is only available when `TELEGRAM_BOT_TOKEN` exists.
- Choosing the only available edit path opens Telegram setup with blank editable values, without silently pre-filling `.env` or draft IDs.
- Focused unit/runtime tests, bootstrap typecheck/build/lint, and task validation are recorded.
