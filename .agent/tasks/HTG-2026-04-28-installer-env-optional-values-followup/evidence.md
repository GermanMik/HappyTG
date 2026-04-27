# Evidence

## Summary

The existing `.env` confirmation now separates "has relevant Telegram values to show" from "can reuse Telegram setup". Optional values without `TELEGRAM_BOT_TOKEN` render a confirmation screen, explain that reuse is unavailable, and continue into a blank Telegram form.

## Checks

- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern "existing env confirmation"`
  - Raw: `raw/test-unit.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Telegram|env|existing|prefill|draft"`
  - Raw: `raw/test-integration.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap run typecheck`
  - Raw: `raw/typecheck.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap run build`
  - Raw: `raw/build.txt`
  - Result: passed.
- `pnpm --filter @happytg/bootstrap run lint`
  - Raw: `raw/lint.txt`
  - Result: passed.
- `pnpm happytg task validate --repo . --task HTG-2026-04-28-installer-env-optional-values-followup`
  - Raw: `raw/task-validate.txt`
  - Result: passed.
