# Installer Existing Env Values Confirmation Prompt

Use this prompt when the HappyTG interactive installer should detect existing `.env` configuration, show the operator what will be reused, ask for explicit confirmation, and stop silently pre-filling Telegram user ID fields.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Create and switch to a dedicated implementation branch:

```bash
git switch -c codex/installer-env-existing-values-confirmation
```

Your task is to update the interactive installer so that existing `.env` data is handled explicitly:

1. During interactive install, after the target repo checkout/path is known and before Telegram setup is accepted, inspect the selected repo's existing `.env`.
2. If relevant values already exist, render a dedicated confirmation screen that shows the existing values and asks whether to reuse them.
3. Secrets must be masked. Telegram bot token may be shown only through the existing masked preview style, never raw.
4. Non-secret values may be shown plainly where safe, including `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_HOME_CHANNEL`, `TELEGRAM_BOT_USERNAME`, local URLs, and port overrides.
5. If the operator confirms reuse, carry those values into the install flow and `.env` merge.
6. If the operator rejects reuse or chooses to edit, continue with the normal setup form, but do not silently prefill Telegram user IDs from `.env` or saved draft state.
7. Remove prefilled Telegram allowed user ID values from the installer form. Existing IDs may appear on the explicit confirmation screen only.

Keep the prior 0.3.7 behavior for Telegram bot tokens: the interactive token entry field must not silently start with `.env` or draft token content. Do not regress the paste/clear behavior for token entry.

## Required Proof Loop

Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` before production edits:

- `spec.md`
- `evidence.md`
- `evidence.json`
- `verdict.json`
- `problems.md`
- `task.json`
- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`

Recommended task id: `HTG-2026-04-28-installer-env-existing-values-confirmation`.

Freeze scope before changing production files. Keep builder and verifier roles separate. The verifier must not edit production code.

## Required Memory Checks

Before implementation, run:

```bash
memory context --project
memory search "installer env telegram allowed user ids prefill confirmation"
memory search "Release 0.3.7 blanks interactive TG token field"
```

Fetch details for any relevant memories with `Details: available`, especially the memory about release 0.3.7 blanking the interactive Telegram token field.

## Current Code To Inspect

Start with these files:

- `packages/bootstrap/src/install/index.ts`
  - `readExistingTelegramSetup()` reads existing `.env` Telegram values.
  - `telegramInitial` currently blanks the interactive token but can still inherit `allowedUserIds` and `homeChannel` from draft or `.env`.
  - The call to `promptTelegramForm()` is the current interactive Telegram setup handoff.
- `packages/bootstrap/src/install/tui.ts`
  - `renderTelegramScreen()`, `promptTelegramForm()`, and the Telegram form reducer define what is shown and what gets edited.
  - Reuse `renderMaskedSecretPreview()` for token display.
- `packages/bootstrap/src/install/env.ts`
  - `mergeEnvTemplate()` and `writeMergedEnvFile()` preserve and merge `.env` values.
- `packages/bootstrap/src/install.runtime.test.ts`
- `packages/bootstrap/src/install.test.ts`

Also inspect docs if behavior is described there:

- `docs/installation.md`
- `docs/configuration.md`
- `docs/quickstart.md`

## UX Requirements

Add a small explicit confirmation step for existing configuration. The screen should answer:

- Which `.env` file was found.
- Which relevant values were found.
- Which values are masked because they are secrets.
- What will happen if the operator confirms reuse.
- What will happen if the operator chooses to edit or re-enter.

Keep output ASCII-safe for Windows terminals.

Suggested choices:

- `Reuse existing .env values`
- `Edit Telegram setup`
- `Continue without optional Telegram IDs` if useful for the flow

The exact labels can follow local TUI conventions, but confirmation must be explicit. Do not rely on a prefilled text field as confirmation.

## Security And Privacy Rules

- Never print raw `TELEGRAM_BOT_TOKEN`.
- Do not write raw tokens, private Telegram IDs, private URLs, or credentials into proof artifacts.
- Test fixtures may use fake IDs/tokens, but evidence files must be sanitized.
- Do not weaken Telegram token validation, Telegram Web App public HTTPS validation, pairing, approval, policy, or serialized mutation invariants.

## Acceptance Criteria

- Interactive install with an existing `.env` containing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_HOME_CHANNEL`, and `TELEGRAM_BOT_USERNAME` shows a dedicated existing-values confirmation screen before reuse.
- The confirmation screen masks the bot token and shows Telegram IDs only as existing `.env` values, not as silently prefilled editable form content.
- Confirming reuse preserves existing Telegram values and writes/merges `.env` as before.
- Choosing edit opens the Telegram form with a blank token field and no prefilled Telegram allowed user IDs.
- Saved draft state does not silently prefill Telegram allowed user IDs in the interactive form.
- Non-interactive install behavior remains compatible with existing CLI/draft/env fallback behavior unless the spec proves a narrower change is required.
- CLI-provided `--allowed-user` values keep working and must be covered explicitly: either they are treated as operator-provided input for this run, or the prompt/spec documents why interactive form display still starts blank.
- Existing token blanking behavior from release 0.3.7 remains covered by regression tests.
- Existing paste behavior for token and allowed user IDs remains covered by regression tests.

## Suggested Test Coverage

Add or update targeted tests for:

- Rendering existing `.env` confirmation with masked token and visible fake allowed user IDs.
- Interactive install transcript where `.env` and saved draft contain Telegram values, proving the Telegram form does not silently prefill allowed user IDs after choosing edit.
- Interactive install transcript where the operator confirms reuse, proving existing Telegram values flow into the final result and env merge.
- Non-interactive install still reuses options/draft/env values.
- Existing token field blank-start regression remains green.

Use fake values only, for example:

- `TELEGRAM_BOT_TOKEN=<masked bot token>`
- `TELEGRAM_ALLOWED_USER_IDS=1001,1002`
- `TELEGRAM_HOME_CHANNEL=@home`
- `TELEGRAM_BOT_USERNAME=happytg_bot`

## Verification Commands

Record outputs under the task bundle's `raw/` directory.

```bash
pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern "Telegram|env|existing|prefill"
pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern "Telegram|env|existing|prefill|draft"
pnpm --filter @happytg/bootstrap build
pnpm --filter @happytg/bootstrap lint
pnpm happytg task validate --repo . --task HTG-2026-04-28-installer-env-existing-values-confirmation
```

If shared CLI, docs, setup/doctor/verify, or `.env` merge behavior changes, also run the repo-level checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg doctor
pnpm happytg verify
```

## Completion Notes

In the final report, include:

1. The branch name.
2. The task id and proof bundle path.
3. A sanitized before/after description of interactive installer behavior.
4. Exact tests and commands run.
5. Any remaining warnings or environment-only blockers.
