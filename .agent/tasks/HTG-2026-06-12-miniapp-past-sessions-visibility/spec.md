# Spec

Task: `HTG-2026-06-12-miniapp-past-sessions-visibility`

## Scope

Fix Mini App project screens where past Codex Desktop sessions can disappear because the UI filters only the first bounded Desktop session window.

## Acceptance Criteria

- General Codex Desktop list stays fast and bounded at `limit=50`.
- Project-filtered Codex Desktop views request a wider initial bounded window.
- Desktop sessions without `projectPath` remain visible in project-filtered views with a clear note.
- The user can request a larger bounded Desktop session window up to `200`.
- Existing Mini App auth/session/Codex tests stay green.

## Out Of Scope

- Full server-side pagination.
- Changing Codex Desktop app-server contracts.
- Changing Desktop mutation behavior.
