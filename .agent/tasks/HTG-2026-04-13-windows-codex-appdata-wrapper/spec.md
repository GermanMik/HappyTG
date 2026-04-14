# Task Spec

- Task ID: HTG-2026-04-13-windows-codex-appdata-wrapper
- Title: Windows Codex APPDATA wrapper detection
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

The released `0.3.3` installer still failed on at least one real Windows machine with the generic missing-Codex message during `setup`, `doctor`, and `verify`, even though Telegram diagnostics were already correctly downgraded. That means bootstrap did not identify the installed Codex wrapper on that host. The likely gap is that wrapper detection still relies primarily on `npm prefix -g`, while common Windows installs expose global shims in standard user npm directories such as `%APPDATA%\\npm` even when npm prefix probing is unavailable from the current shell. The fix must extend the existing bootstrap/runtime path, preserve true missing-install diagnostics, and keep installer follow-up states at warning level for runnable wrapper cases.

## Acceptance Criteria

1. Bootstrap detects runnable Codex wrappers in standard Windows npm user bin locations even when npm prefix probing is unavailable.
2. Installer post-checks treat that state as PATH follow-up warning instead of recoverable failure.
3. Diagnostics remain actionable for truly missing Codex installs.

## Constraints

- Runtime: Codex CLI
- Extend only the existing bootstrap/install diagnostics flow.
- Preserve the distinction between truly missing Codex and PATH-follow-up wrapper cases.
- Keep Windows shim handling and current release behavior intact outside this narrower detection gap.

## Verification Plan

- Unit: add bootstrap and installer regressions for `%APPDATA%\\npm`-style wrapper detection when npm prefix probing is unavailable.
- Integration: run targeted bootstrap tests plus build/typecheck for the touched files.
- Manual: confirm runnable wrapper cases no longer surface the generic missing-Codex message.
