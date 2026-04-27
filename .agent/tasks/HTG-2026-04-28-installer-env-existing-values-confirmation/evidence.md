# Evidence

## Summary

Implemented an explicit interactive existing `.env` confirmation screen for Telegram setup reuse. The edit path opens the normal Telegram form with a blank token and without silently carrying allowed user IDs from `.env` or saved draft state. The reuse path carries existing `.env` Telegram values into the install result and env merge.

## Commands

- PASS: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern "Telegram|env|existing|prefill"`
- PASS: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Telegram|env|existing|prefill|draft"`
- PASS: `pnpm --filter @happytg/bootstrap build`
- PASS: `pnpm --filter @happytg/bootstrap lint`
- PASS: `pnpm happytg task validate --repo . --task HTG-2026-04-28-installer-env-existing-values-confirmation`

## Sanitization

Proof artifacts use fake Telegram tokens and fake allowed user IDs only. Raw real `.env` secrets are not recorded. Command output artifacts contain test names and pass/fail summaries only.
