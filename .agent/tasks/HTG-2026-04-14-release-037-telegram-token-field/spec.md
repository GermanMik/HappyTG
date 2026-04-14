# Task Spec

- Task ID: HTG-2026-04-14-release-037-telegram-token-field
- Title: Fix release 0.3.7 Telegram token field
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

Release 0.3.7 needs a focused fix for the Telegram bot token field in the interactive installer. The current interactive flow reuses persisted token data from install draft state and existing .env values, so the token field is already populated when the user opens it. In practice that causes the first pasted token to append onto stale content instead of replacing it, forces the user to manually erase hidden state, and makes the paste path brittle enough that a clear-then-paste retry can fail in real usage. The fix must stay minimal: remove unwanted interactive token prefill without regressing non-interactive draft resume, preserve the existing reducer behavior for repeat paste after clearing, and ship aligned release 0.3.7 metadata.

## Acceptance Criteria

1. Interactive Telegram token entry starts blank instead of reusing persisted token values from draft or .env.
2. Pasting a Telegram token into the interactive field no longer appends onto stale existing content, and clearing the field then pasting again remains supported.
3. Release metadata is updated to 0.3.7 and release validation passes.

## Constraints

- Runtime: Codex CLI.
- Keep the diff minimal and scoped to the Telegram token field plus release metadata.
- Do not regress non-interactive install resume that intentionally reuses saved Telegram token draft state.
- Preserve existing Telegram reducer masking, validation, and paste handling for allowed user IDs and home channel.
- Out of scope: broader installer UX changes, storage redesign for draft state, and unrelated bootstrap/runtime fixes.

## Verification Plan

- Unit: add reducer coverage for clearing a token field that started with a value and then pasting a replacement token.
- Integration: add interactive install coverage that proves the Telegram token prompt no longer renders persisted token content from .env during the initial interactive screen, then accepts a newly pasted token.
- Manual/proof: run targeted bootstrap tests and release validation, store outputs under raw/, and validate the task bundle structure.

