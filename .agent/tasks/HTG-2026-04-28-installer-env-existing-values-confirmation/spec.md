# HTG-2026-04-28-installer-env-existing-values-confirmation

## Frozen Scope

Update the HappyTG interactive installer so existing `.env` Telegram configuration is surfaced through an explicit confirmation step after the target repo path is selected and before Telegram setup is accepted.

## In Scope

- Inspect the selected repo `.env` once the repo path/mode is known.
- When relevant existing Telegram values are present, render a dedicated confirmation screen before the Telegram setup form.
- Mask `TELEGRAM_BOT_TOKEN` with the existing masked preview style; never render it raw.
- Show safe non-secret values plainly on the confirmation screen, including fake/test `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_HOME_CHANNEL`, and `TELEGRAM_BOT_USERNAME`.
- If reuse is confirmed, carry existing values into the install result and `.env` merge.
- If edit is selected, open the Telegram form with a blank token and no silently prefilled allowed user IDs from `.env` or draft.
- Keep CLI-provided `--allowed-user` values as operator input for the current run.
- Preserve non-interactive fallback behavior for options, draft, and existing `.env`.
- Keep the 0.3.7 blank interactive token behavior and existing token/allowed-user paste behavior covered by regression tests.

## Out of Scope

- Redesigning `.env` parsing or merge semantics.
- Changing Telegram token validation, Web App HTTPS validation, pairing, approval, policy, or serialized mutation invariants.
- Changing unrelated installer launch, Docker, port-preflight, doctor, or verify behavior.
- Writing real user secrets or private identifiers to proof artifacts.

## Acceptance Criteria

- Interactive install with existing `.env` Telegram values shows an explicit existing-values confirmation screen.
- The confirmation masks bot token and displays fake allowed IDs only as existing `.env` values, not as editable form prefill.
- Confirming reuse preserves existing Telegram values through final result and env merge.
- Choosing edit opens Telegram setup with blank token and no prefilled allowed user IDs from `.env` or draft.
- Saved draft state does not silently prefill allowed user IDs in the interactive form.
- Non-interactive install keeps compatible fallback behavior.
- CLI-provided allowed users still work as operator-provided input.
- Required targeted tests and build/lint/task validation outputs are recorded under `raw/`.

## Discipline Notes

- Builder and verifier roles are separate. The verifier must not edit production code.
- Scope is frozen before production edits.
- Fresh verification is required after fixes.
