# HTG-2026-05-03-usability-design-pass Spec

Status: frozen
Frozen at: 2026-05-03

## Objective

Make daily HappyTG operation simpler in the Telegram Mini App and Telegram Bot without weakening runtime, policy, approval, audit, source/runtime, or release safety.

## Target Surfaces

- Mini App home/dashboard.
- Mini App session cards and session detail entry points.
- Mini App approvals list/detail.
- Mini App Codex Desktop/CLI labeling and unsupported-state truth.
- Telegram Bot `/start`, `/menu`, `/sessions`, session cards, approvals, unknown/recovery paths, and Codex Desktop/CLI menus.

## Frozen Implementation Scope

1. Mini App dashboard becomes decision-first:
   - Show the top attention item and its next action in the first hero section when something needs attention.
   - Keep raw logs and long details out of the first view.
   - Keep existing projection/API contracts intact.
2. Mini App session cards become more scannable:
   - Localize raw `nextAction`/attention labels into short Russian operator copy.
   - Keep source/runtime labels explicit for Codex CLI and Codex Desktop.
   - Avoid exposing raw payloads or transcript text.
3. Mini App approval detail exposes all existing safe approval scopes:
   - Add the session-scope approval button already supported by bot/API.
   - Preserve nonce and authenticated Mini App resolve flow.
4. Bot menu/session messages become next-action oriented:
   - Add one concise `Следующее:` line to the main menu based on approvals, problem sessions, active sessions, host/repo availability, or first-use state.
   - Add concise attention hints to the active sessions list.
   - Keep chat short and push details to Mini App.
5. Add focused tests for changed text/buttons/disabled-source behavior where touched.

## Non-Goals

- No new architecture, framework migration, or new backend transport.
- No callback contract changes.
- No policy/approval ordering changes.
- No release/version bump unless explicitly requested after this pass.
- No raw log, raw transcript, token, or secret exposure.
- No implementation of unsupported Codex Desktop actions beyond existing adapter contracts.

## Acceptance Criteria

- Mini App home shows a top next action when approvals, blocked sessions, verify problems, or stale hosts exist.
- Mini App session cards use user-facing Russian action/attention labels rather than raw internal tokens.
- Mini App approval detail includes once, phase, session, and reject actions, preserving nonce attributes.
- Bot `/menu` remains concise and includes a single next action.
- Bot active sessions list includes attention hints without dumping details.
- Existing Mini App reverse-proxy/auth behavior remains intact.
- Existing bot Mini App HTTPS gating remains intact.
- Tests cover the changed UI text/buttons.
- Required verification commands are run and raw outputs are saved when available.

## Evidence Requirements

- 10-role independent assessment and synthesis table in `evidence.md`.
- Raw command outputs under `raw/`.
- Fresh verifier verdict in `verdict.json` and summarized in `evidence.md`.
- Any skipped command recorded with exact reason and residual risk in `problems.md`.
