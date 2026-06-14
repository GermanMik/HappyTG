# HTG-2026-06-14-desktop-readonly-history-controls

## Scope

Fix Mini App Codex Desktop continue failures for old JSONL-backed sessions where the local history exists but `codex app-server` no longer knows the thread.

## Acceptance Criteria

- File-backed Codex Desktop sessions remain visible with bounded history.
- `resume`, `continue`, and `stop` are disabled for sessions not confirmed by the control contract.
- Sessions confirmed by app-server or host-proxy remain controllable.
- Regression coverage proves JSONL-only sessions are marked read-only.
- Smallest relevant validation is recorded under `raw/`.

