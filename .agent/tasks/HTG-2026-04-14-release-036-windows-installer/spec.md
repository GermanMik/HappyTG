# Task Spec

- Task ID: HTG-2026-04-14-release-036-windows-installer
- Title: Fix release 0.3.6 Windows installer paste and guidance
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The Windows interactive installer still has a real paste-path gap in the Telegram setup form. The current TUI input flow assumes printable chunks and confirm keys arrive separately, but real terminal paste on Windows can deliver a multi-character chunk that already contains trailing CR/LF, leaving pasted bot tokens and allowed user IDs uncommitted or otherwise mishandled inside the raw-mode reducer. At the same time, bootstrap guidance is accurate about Redis warnings in parts of the codebase but still sounds too Docker-centric in final next steps and setup guidance, even though the repo already supports non-Docker alternatives such as system Redis or an externally configured `REDIS_URL`. The fix must stay minimal, preserve the 0.3.5 final-summary aggregation behavior, keep the installer UX native, and prepare release metadata for `0.3.6`.

## Acceptance Criteria

1. Windows interactive Telegram token paste accepts terminal paste chunks with trailing newline or CRLF and preserves installer-native validation/masking.
2. Windows interactive allowed user ID paste accepts at least one pasted numeric ID and preserves typed input/navigation behavior.
3. Installer/bootstrap guidance explicitly names supported non-Docker infra alternatives such as system Redis or external `REDIS_URL` and no longer implies Docker is the only path when alternatives are already supported.
4. Release metadata is updated to `0.3.6` with changelog and release notes, and release validation passes.

## Constraints

- Runtime: Codex CLI.
- Keep the diff minimal and avoid unrelated refactors.
- Do not regress the 0.3.5 warning/next-step aggregation and `success-with-warnings` behavior.
- Preserve Linux/macOS/Windows compatibility and existing `pnpm happytg install`, `setup`, `doctor`, `repair`, and `verify` entrypoints.
- Do not claim raw OS clipboard support where the TTY path only receives terminal-injected paste text.

## Verification Plan

- Add reducer-level regression coverage for pasted Telegram chunks that include trailing newline/CRLF and bracketed-paste markers.
- Add interactive-form coverage that exercises the real `promptTelegramForm` keypress path for pasted token and allowed-user-id input.
- Add bootstrap guidance assertions for Redis/non-Docker wording and keep existing 0.3.5 summary aggregation tests green.
- Run targeted bootstrap test/typecheck and release validation, then capture outputs in the task bundle.
