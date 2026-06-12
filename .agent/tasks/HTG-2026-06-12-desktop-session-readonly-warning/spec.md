# HTG-2026-06-12 Desktop Session Read-only Warning Spec

Status: frozen before production-code edits.
Branch: `codex/desktop-past-session-warning`

## Goal

Fix the Mini App experience when opening past Codex Desktop sessions: read-only history/detail viewing must not look like a page-level error just because Desktop mutation controls are unsupported.

## Scope

- Adjust Mini App rendering for Codex Desktop session list/detail unsupported controls.
- Keep unsupported Desktop mutations honest: disabled buttons/forms and API `CODEX_DESKTOP_CONTROL_UNSUPPORTED` behavior must remain.
- Add regression coverage for past Desktop session detail rendering.
- Record focused validation evidence.

## Non-Goals

- Do not enable Codex Desktop Resume/Stop/New Task without an available supported control contract.
- Do not weaken policy, approval, serialized mutation, audit, auth, or Telegram `initData` behavior.
- Do not change API/runtime-adapter action semantics unless tests prove UI-only handling is insufficient.
- Do not add Ollama or cloud dependencies.

## Acceptance Criteria

- Opening `/codex/desktop-session?id=...` for a read-only past Desktop session returns HTTP 200 and shows history.
- The detail page does not render the page-level `Desktop actions may be disabled` warning for read-only browsing.
- Disabled Desktop action controls still expose the unsupported reason in button titles where useful.
- Unsupported reason codes still appear only in action-disabled context, not as a top-level session-entry error.
- `pnpm --filter @happytg/miniapp test` passes.
